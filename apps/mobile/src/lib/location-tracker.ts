import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { ApiClient } from './api';
import { deviceLocale, translatorFor } from './i18n';
import { LocationQueue } from './location-batch';

export const LOCATION_TASK = 'resget-courier-location';
/** How often the queue is flushed to the API while a trip runs. */
const FLUSH_INTERVAL_MS = 5000;

const queue = new LocationQueue();
let flusher: ReturnType<typeof setInterval> | null = null;
let context: { api: ApiClient; restaurantId: string } | null = null;
let lastSentAt: Date | null = null;
/** The batch on the wire; a second flush waits for it instead of sending the same points again. */
let sending: Promise<void> | null = null;

interface TaskBody {
  locations?: Location.LocationObject[];
}

/** The part of the API's ingest answer the app reads (apps/api/src/modules/dispatch/location.service.ts). */
interface IngestResult {
  tracked: boolean;
  accepted: number;
}

/**
 * Background positions land here even when the screen is off; they wait in
 * the queue and go out in batches (docs/SIPARIS_VE_SEVK.md, section 7).
 * The task is defined once at module load, as Expo requires.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  for (const fix of (data as TaskBody).locations ?? []) {
    queue.push({
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      recordedAt: new Date(fix.timestamp).toISOString(),
      ...(fix.coords.heading !== null && fix.coords.heading >= 0
        ? { headingDeg: Math.min(360, fix.coords.heading) }
        : {}),
      ...(fix.coords.speed !== null && fix.coords.speed >= 0 ? { speedMps: Math.min(100, fix.coords.speed) } : {}),
      ...(fix.coords.accuracy !== null ? { accuracyM: Math.min(5000, Math.max(0, fix.coords.accuracy)) } : {}),
    });
  }
});

export async function requestLocationPermission(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted';
}

/** Starts collecting while a trip is running; a second call with the same restaurant is a no-op. */
export async function startTracking(api: ApiClient, restaurantId: string): Promise<void> {
  context = { api, restaurantId };
  const t = translatorFor(deviceLocale());
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (!running) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 4000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: t('mobile.location.notificationTitle'),
        notificationBody: t('mobile.location.notificationBody'),
      },
    });
  }
  if (!flusher) flusher = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}

export async function stopTracking(): Promise<void> {
  if (flusher) clearInterval(flusher);
  flusher = null;
  if (sending) await sending;
  await flush();
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  queue.clear();
  context = null;
}

export function lastLocationSentAt(): Date | null {
  return lastSentAt;
}

/**
 * Sends the oldest batch; keeps it on failure so an offline gap is replayed, not lost.
 * Only one batch is in flight: overlapping calls would post the same points twice
 * and the second acknowledgement would drop points that were never sent.
 */
export function flush(): Promise<void> {
  if (!sending) {
    sending = sendBatch().finally(() => {
      sending = null;
    });
  }
  return sending;
}

async function sendBatch(): Promise<void> {
  if (!context || queue.size === 0) return;
  const batch = queue.nextBatch();
  try {
    await context.api.request<IngestResult>(`restaurants/${context.restaurantId}/courier/me/location`, {
      method: 'POST',
      restaurantId: context.restaurantId,
      body: { points: batch },
    });
    queue.ack(batch.length);
    lastSentAt = new Date();
  } catch {
    // Network or session trouble: the points stay queued for the next flush.
  }
}
