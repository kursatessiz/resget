import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CourierProviderAdapter } from '@resget/shared';
import { MockCourierAdapter } from './mock-courier.adapter';

/**
 * Courier networks by code. Only MOCK ships today, and only outside
 * production: there a courier call or webhook for MOCK finds no network and
 * is refused instead of faking a dispatch. A real network is added here and
 * in the CourierProvider table, never in the order flow (docs/KURYE.md).
 */
@Injectable()
export class CourierRegistry {
  private readonly adapters = new Map<string, CourierProviderAdapter>();

  constructor(config: ConfigService) {
    if (config.get<string>('NODE_ENV') !== 'production') {
      this.register(new MockCourierAdapter(config.get<string>('COURIER_WEBHOOK_SECRET')));
    }
  }

  register(adapter: CourierProviderAdapter): void {
    this.adapters.set(adapter.code, adapter);
  }

  get(code: string): CourierProviderAdapter | null {
    return this.adapters.get(code) ?? null;
  }

  codes(): string[] {
    return [...this.adapters.keys()];
  }
}
