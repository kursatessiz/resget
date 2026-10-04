import type { SmsProvider, SmsSendResult } from '../sms.provider';
import { basicAuth, callProvider } from './http';

export interface TwilioOptions {
  accountSid: string;
  authToken: string;
  /** E.164 sender number or an approved alphanumeric sender id. */
  from: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface TwilioMessageResponse {
  sid?: string;
  status?: string;
  error_code?: number | null;
  message?: string;
}

/** Statuses Twilio returns on creation that mean the message was taken. */
const TWILIO_ACCEPTED = new Set(['queued', 'accepted', 'sending', 'sent', 'scheduled']);

/**
 * Twilio Programmable Messaging (docs/MESAJLASMA.md, "Sağlayıcılar"); the
 * global default outside Turkey. Twilio bills in money, not credits, so no
 * balance is reported: the console shows it as unknown rather than
 * comparing an amount with a credit threshold.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly code = 'TWILIO';
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TwilioOptions) {
    this.base = (options.baseUrl ?? 'https://api.twilio.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(toE164: string, text: string): Promise<SmsSendResult> {
    const answer = await callProvider<TwilioMessageResponse>(this.fetchImpl, {
      url: `${this.base}/2010-04-01/Accounts/${encodeURIComponent(this.options.accountSid)}/Messages.json`,
      headers: { authorization: basicAuth(this.options.accountSid, this.options.authToken) },
      form: { To: toE164, From: this.options.from, Body: text },
    });
    const status = answer.body?.status ?? '';
    if (!answer.ok || !answer.body?.sid || !TWILIO_ACCEPTED.has(status)) return { accepted: false, providerRef: null };
    return { accepted: true, providerRef: answer.body.sid };
  }
}
