import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskPushToken } from '@resget/shared';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushTicket {
  token: string;
  accepted: boolean;
  /** The service says this token no longer exists (app removed, token rotated): the device is disabled. */
  deviceGone: boolean;
  error: string | null;
}

export interface PushProvider {
  readonly code: string;
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/**
 * Development provider: accepts every message outside production and refuses
 * all of them in it, so a production deployment without a real provider
 * falls back to the paid channels instead of pretending. A token containing
 * "gone" is reported as unregistered, which lets tests cover that path.
 */
@Injectable()
export class MockPushProvider implements PushProvider {
  readonly code = 'MOCK';
  private readonly logger = new Logger(MockPushProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const env = this.config.get<string>('NODE_ENV');
    return messages.map((message) => {
      if (env === 'production') {
        this.logger.error(`MOCK push provider refused to send in production to ${maskPushToken(message.token)}`);
        return { token: message.token, accepted: false, deviceGone: false, error: 'PROVIDER_REJECTED' };
      }
      if (message.token.includes('gone')) {
        return { token: message.token, accepted: false, deviceGone: true, error: 'DEVICE_GONE' };
      }
      if (env === 'development') this.logger.log(`MOCK push to ${maskPushToken(message.token)}: ${message.title}`);
      return { token: message.token, accepted: true, deviceGone: false, error: null };
    });
  }
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Expo's push service accepts at most this many messages per request. */
const EXPO_CHUNK = 100;
const EXPO_TIMEOUT_MS = 10_000;

/**
 * Expo push service (https://exp.host/--/api/v2/push/send). The app's tokens
 * are Expo tokens, so one adapter covers iOS and Android; APNs and FCM
 * credentials live in the Expo project, never here. The optional access
 * token is only needed when the project enforces it.
 */
@Injectable()
export class ExpoPushProvider implements PushProvider {
  readonly code = 'EXPO';
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
      tickets.push(...(await this.sendChunk(messages.slice(i, i + EXPO_CHUNK))));
    }
    return tickets;
  }

  private async sendChunk(chunk: PushMessage[]): Promise<PushTicket[]> {
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            priority: 'high',
          })),
        ),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Expo push responded ${response.status}`);
        return chunk.map((m) => ({ token: m.token, accepted: false, deviceGone: false, error: 'PROVIDER_ERROR' }));
      }
      const payload = (await response.json()) as { data?: ExpoTicket[] };
      return chunk.map((m, index) => {
        const ticket = payload.data?.[index];
        if (ticket?.status === 'ok') return { token: m.token, accepted: true, deviceGone: false, error: null };
        const gone = ticket?.details?.error === 'DeviceNotRegistered';
        return { token: m.token, accepted: false, deviceGone: gone, error: gone ? 'DEVICE_GONE' : 'PROVIDER_REJECTED' };
      });
    } catch (error) {
      this.logger.warn(`Expo push failed: ${error instanceof Error ? error.message : 'error'}`);
      return chunk.map((m) => ({ token: m.token, accepted: false, deviceGone: false, error: 'PROVIDER_ERROR' }));
    } finally {
      clearTimeout(timer);
    }
  }
}
