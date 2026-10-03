import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MealCardAdapter, MealCardProviderCode } from '@resget/shared';
import { MockMealCardAdapter } from './mock-meal-card.adapter';

/**
 * Meal card issuers with an online payment adapter. Door acceptance needs
 * none; online acceptance of an issuer is possible only once its adapter is
 * registered here (and the restaurant holds a member merchant contract).
 */
@Injectable()
export class MealCardsRegistry {
  private readonly adapters = new Map<MealCardProviderCode, MealCardAdapter>();
  readonly includeMock: boolean;

  constructor(config: ConfigService) {
    this.includeMock = config.get<string>('NODE_ENV') !== 'production';
    if (this.includeMock) this.register(new MockMealCardAdapter());
  }

  register(adapter: MealCardAdapter): void {
    this.adapters.set(adapter.code, adapter);
  }

  get(code: string): MealCardAdapter | null {
    return this.adapters.get(code as MealCardProviderCode) ?? null;
  }

  has(code: string): boolean {
    return this.adapters.has(code as MealCardProviderCode);
  }
}
