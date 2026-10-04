import * as SecureStore from 'expo-secure-store';
import type { TokenPairDTO } from '@resget/shared';
import type { TokenStore } from './api';

const TOKENS_KEY = 'resget.tokens';
const RESTAURANT_KEY = 'resget.restaurant';

/** Tokens live in the device keychain or keystore, never in plain storage. */
export const secureTokens: TokenStore = {
  async read(): Promise<TokenPairDTO | null> {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenPairDTO;
    } catch {
      return null;
    }
  },
  async write(tokens: TokenPairDTO | null): Promise<void> {
    if (tokens) await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(TOKENS_KEY);
  },
};

/** The restaurant the person last worked in, so the app reopens there. */
export async function readLastRestaurant(): Promise<string | null> {
  return SecureStore.getItemAsync(RESTAURANT_KEY);
}

export async function writeLastRestaurant(restaurantId: string | null): Promise<void> {
  if (restaurantId) await SecureStore.setItemAsync(RESTAURANT_KEY, restaurantId);
  else await SecureStore.deleteItemAsync(RESTAURANT_KEY);
}
