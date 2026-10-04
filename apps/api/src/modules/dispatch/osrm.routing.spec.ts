import { DEFAULT_DISPATCH_SETTINGS, haversineLegs } from '@resget/shared';
import { createOsrmRouting } from './osrm.routing';

const A = { lat: 40.985, lng: 29.03 };
const B = { lat: 40.99, lng: 29.04 };
const C = { lat: 41.0, lng: 29.05 };
const silent = { warn: () => undefined };

function fetchWith(body: unknown, status = 200): typeof fetch {
  return (async () => ({ ok: status < 400, status, json: async () => body }) as Response) as typeof fetch;
}

describe('OSRM routing adapter', () => {
  it('maps route legs and rounds to whole metres and seconds', async () => {
    const routing = createOsrmRouting({
      baseUrl: 'https://osrm.test/',
      settings: DEFAULT_DISPATCH_SETTINGS,
      logger: silent,
      fetchImpl: fetchWith({
        code: 'Ok',
        routes: [
          {
            legs: [
              { distance: 1234.6, duration: 321.4 },
              { distance: 800, duration: 200 },
            ],
          },
        ],
      }),
    });
    expect(routing.code).toBe('OSRM');
    await expect(routing.legs([A, B, C])).resolves.toEqual([
      { distanceMeters: 1235, durationSeconds: 321 },
      { distanceMeters: 800, durationSeconds: 200 },
    ]);
  });

  it('falls back to the straight-line estimate on errors, timeouts and short answers', async () => {
    const expected = haversineLegs([A, B], DEFAULT_DISPATCH_SETTINGS);
    const failing = createOsrmRouting({
      baseUrl: 'https://osrm.test',
      settings: DEFAULT_DISPATCH_SETTINGS,
      logger: silent,
      fetchImpl: fetchWith({ message: 'down' }, 503),
    });
    await expect(failing.legs([A, B])).resolves.toEqual(expected);

    const notOk = createOsrmRouting({
      baseUrl: 'https://osrm.test',
      settings: DEFAULT_DISPATCH_SETTINGS,
      logger: silent,
      fetchImpl: fetchWith({ code: 'NoRoute' }),
    });
    await expect(notOk.legs([A, B])).resolves.toEqual(expected);

    const hanging = createOsrmRouting({
      baseUrl: 'https://osrm.test',
      settings: DEFAULT_DISPATCH_SETTINGS,
      logger: silent,
      timeoutMs: 10,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    await expect(hanging.legs([A, B])).resolves.toEqual(expected);
  });

  it('builds the optimiser matrix from the table service and fills unreachable pairs', async () => {
    const routing = createOsrmRouting({
      baseUrl: 'https://osrm.test',
      settings: DEFAULT_DISPATCH_SETTINGS,
      logger: silent,
      fetchImpl: fetchWith({
        code: 'Ok',
        distances: [
          [0, 1500, null],
          [1500, 0, 900],
          [null, 900, 0],
        ],
      }),
    });
    const matrix = await routing.matrix!([A, B, C]);
    expect(matrix[0][1]).toBe(1500);
    expect(matrix[1][2]).toBe(900);
    expect(matrix[0][2]).toBe(haversineLegs([A, C], DEFAULT_DISPATCH_SETTINGS)[0].distanceMeters);
  });
});
