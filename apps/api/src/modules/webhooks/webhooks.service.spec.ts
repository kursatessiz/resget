import dns from 'node:dns';
import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { CredentialCipher, DEV_CREDENTIAL_KEY, EnvKeyProvider } from '../../common/crypto/credential-cipher';
import type { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from './webhooks.service';

/** A documentation-range address (RFC 5737): public as far as the guard is concerned, never routed. */
const PUBLIC_ANSWER = '192.0.2.1';

describe('WebhooksService delivery (DNS rebinding)', () => {
  let loopback: Server;
  let loopbackPort = 0;
  const loopbackConnections: Socket[] = [];

  beforeAll(async () => {
    loopback = createServer((socket) => {
      loopbackConnections.push(socket);
      socket.destroy();
    });
    await new Promise<void>((resolve) => loopback.listen(0, '127.0.0.1', resolve));
    loopbackPort = (loopback.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => loopback.close(() => resolve()));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    loopbackConnections.length = 0;
  });

  it('never connects to a loopback answer that follows a public answer for the same name', async () => {
    // A rebinding resolver: the first query for the name answers a public address, every later one answers loopback.
    let queries = 0;
    const answer = (): string => {
      queries += 1;
      return queries === 1 ? PUBLIC_ANSWER : '127.0.0.1';
    };
    jest.spyOn(dns, 'lookup').mockImplementation(((
      _host: string,
      options: { all?: boolean },
      callback: (err: Error | null, address: unknown, family?: number) => void,
    ) => {
      const address = answer();
      if (options.all) callback(null, [{ address, family: 4 }]);
      else callback(null, address, 4);
    }) as never);

    const cipher = new CredentialCipher(new EnvKeyProvider(DEV_CREDENTIAL_KEY));
    const delivery = {
      id: 'd-1',
      event: 'order.updated',
      createdAt: new Date(),
      payload: {},
      attempts: 0,
      webhook: {
        id: 'w-1',
        url: `https://rebind.example.test:${loopbackPort}/hook`,
        secretEncrypted: cipher.encrypt('whsec_test'),
        failureCount: 0,
      },
    };
    const updates: Array<{ status?: string; lastError?: string | null }> = [];
    const prisma = {
      webhookDelivery: {
        findMany: async () => [delivery],
        update: (args: { data: { status?: string; lastError?: string | null } }) => {
          updates.push(args.data);
          return args;
        },
      },
      restaurantWebhook: { update: (args: unknown) => args },
      $transaction: async (ops: unknown[]) => ops,
    } as unknown as PrismaService;
    const config = { get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined) } as ConfigService;

    const service = new WebhooksService(prisma, config);
    const sent = await service.runPass(new Date());

    expect(sent).toBe(0);
    expect(loopbackConnections.length).toBe(0);
    expect(updates[0]?.status).toBe('PENDING');
  }, 20000);
});
