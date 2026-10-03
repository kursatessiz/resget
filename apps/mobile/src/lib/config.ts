/**
 * Build-time configuration. EXPO_PUBLIC_* variables are inlined by Expo at
 * bundle time; the API base URL is the only one the app needs. Development
 * falls back to the local API so Expo Go works out of the box.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Hard-coded keys never ship in the bundle; everything else comes from the API. */
export const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION ?? 'dev';
