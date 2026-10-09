import type { ApiClient } from './api';

type TaskCallback = (body: { data?: unknown; error?: unknown }) => Promise<void>;
const registered: { task: TaskCallback | null } = { task: null };

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, task: TaskCallback) => {
    registered.task = task;
  },
}));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  hasStartedLocationUpdatesAsync: async () => true,
  startLocationUpdatesAsync: async () => undefined,
  stopLocationUpdatesAsync: async () => undefined,
}));
jest.mock('./i18n', () => ({
  deviceLocale: () => 'tr',
  translatorFor: () => (key: string) => key,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks above
const tracker = require('./location-tracker') as typeof import('./location-tracker');

function fix(seconds: number) {
  return {
    coords: { latitude: 41, longitude: 29, heading: null, speed: null, accuracy: 5 },
    timestamp: Date.UTC(2026, 9, 9, 12, 0, seconds),
  };
}

describe('location tracker flush', () => {
  afterEach(async () => {
    await tracker.stopTracking();
  });

  it('keeps one batch in flight so overlapping flushes neither repeat nor drop points', async () => {
    const posted: number[] = [];
    const pending: (() => void)[] = [];
    const api = {
      request: (_path: string, init: { body: { points: unknown[] } }) => {
        posted.push(init.body.points.length);
        return new Promise((resolve) => pending.push(() => resolve({ tracked: true, accepted: 0 })));
      },
    } as unknown as ApiClient;

    await tracker.startTracking(api, 'r1');
    await registered.task?.({ data: { locations: [fix(0), fix(5)] } });

    const first = tracker.flush();
    const second = tracker.flush();
    expect(second).toBe(first);
    expect(posted).toEqual([2]);

    await registered.task?.({ data: { locations: [fix(10)] } });
    pending.shift()?.();
    await first;

    const third = tracker.flush();
    expect(posted).toEqual([2, 1]);
    pending.shift()?.();
    await third;
    expect(tracker.lastLocationSentAt()).not.toBeNull();
  });
});
