import './support/realtime-reauth';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { API_KEY_HEADER } from '@resget/shared';
import type { RealtimeEvent } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { RealtimeService, dispatchTopic } from '../../src/modules/realtime/realtime.service';

interface OpenStream {
  frames: string[];
  ended: () => boolean;
  waitForEnd: (ms: number) => Promise<boolean>;
  waitForFrame: (match: string, ms: number) => Promise<string | null>;
  close: () => void;
}

/** An open event stream outlives none of the rights it was opened with (docs/SIPARIS_VE_SEVK.md, "Canlı akış yetkisi"). */
describe('Realtime stream revocation (e2e)', () => {
  let ctx: TestContext;
  let restaurantId: string;
  let ownerToken: string;
  let staffToken: string;
  let staffUserId: string;
  let membershipId: string;
  let roleId: string;
  let port: number;
  const staffPhone = '+905329990771';
  const customerPhone = '+905551112233';

  beforeAll(async () => {
    ctx = await createTestApp();
    restaurantId = (await ctx.prisma.restaurant.findUniqueOrThrow({ where: { slug: SEED.restaurantSlug } })).id;
    await ctx.prisma.user.deleteMany({ where: { phone: staffPhone } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { restaurantId, name: 'E2E Canli Akis' } });
    const role = await ctx.prisma.roleTemplate.create({
      data: {
        restaurantId,
        name: 'E2E Canli Akis',
        permissions: { create: [{ permissionKey: 'orders.view' }, { permissionKey: 'customers.contact.view' }] },
      },
    });
    roleId = role.id;
    const user = await ctx.prisma.user.create({ data: { phone: staffPhone, fullName: 'E2E Akis Personeli' } });
    staffUserId = user.id;
    membershipId = (
      await ctx.prisma.membership.create({
        data: { userId: user.id, restaurantId, roleTemplateId: role.id, status: 'ACTIVE' },
      })
    ).id;
    [ownerToken, staffToken] = await Promise.all([ctx.login(SEED.ownerPhone), ctx.login(staffPhone)]);
    const server = ctx.app.getHttpServer() as http.Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await ctx.prisma.restaurantApiKey.deleteMany({ where: { restaurantId, name: { startsWith: 'E2E Akis' } } });
    await ctx.prisma.membership.deleteMany({ where: { id: membershipId } });
    await ctx.prisma.user.deleteMany({ where: { phone: staffPhone } });
    await ctx.prisma.roleTemplate.deleteMany({ where: { id: roleId } });
    await ctx.close();
  });

  afterEach(async () => {
    await ctx.prisma.membership.update({ where: { id: membershipId }, data: { status: 'ACTIVE' } });
    await ctx.prisma.roleTemplatePermission.upsert({
      where: { roleTemplateId_permissionKey: { roleTemplateId: roleId, permissionKey: 'customers.contact.view' } },
      create: { roleTemplateId: roleId, permissionKey: 'customers.contact.view' },
      update: {},
    });
  });

  const open = (headers: Record<string, string>): Promise<OpenStream> =>
    new Promise((resolve, reject) => {
      const frames: string[] = [];
      let buffer = '';
      let done = false;
      const request = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/restaurants/${restaurantId}/orders/events`,
          headers: { accept: 'text/event-stream', ...headers },
        },
        (res) => {
          if (res.statusCode !== 200) return reject(new Error(`stream refused with ${res.statusCode}`));
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            const parts = buffer.split('\n\n');
            buffer = parts.pop() ?? '';
            frames.push(...parts.filter(Boolean));
          });
          res.on('end', () => {
            done = true;
          });
          res.on('close', () => {
            done = true;
          });
          resolve({
            frames,
            ended: () => done,
            waitForEnd: (ms) => poll(() => done, ms),
            waitForFrame: async (match, ms) => {
              const found = () => frames.find((f) => f.includes(match)) ?? null;
              return (await poll(() => found() !== null, ms)) ? found() : null;
            },
            close: () => request.destroy(),
          });
        },
      );
      request.on('error', (err) => {
        if (!done) reject(err);
      });
    });

  const poll = (check: () => boolean, ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (check()) return resolve(true);
        if (Date.now() - started > ms) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** A live order event as the orders service publishes it, carrying the customer's number. */
  const publishOrder = (marker: string) => {
    const event = {
      type: 'order.updated',
      order: {
        id: marker,
        restaurantId,
        status: 'PLACED',
        customer: { name: 'E2E Musteri', phone: customerPhone },
        address: { line1: 'Sokak 1', contactPhone: customerPhone },
      },
    } as unknown as RealtimeEvent;
    ctx.app.get(RealtimeService).publish(dispatchTopic(restaurantId), event);
  };

  it('keeps delivering while the subscriber still holds its rights', async () => {
    const stream = await open(bearer(staffToken));
    try {
      await sleep(2500);
      expect(stream.ended()).toBe(false);
      publishOrder('still-allowed');
      const frame = await stream.waitForFrame('still-allowed', 3000);
      expect(frame).toContain(customerPhone);
    } finally {
      stream.close();
    }
  });

  it('closes when the membership stops being active', async () => {
    const stream = await open(bearer(staffToken));
    try {
      await ctx.prisma.membership.update({ where: { id: membershipId }, data: { status: 'PASSIVE' } });
      expect(await stream.waitForEnd(5000)).toBe(true);
      publishOrder('after-passive');
      await sleep(300);
      expect(stream.frames.some((f) => f.includes('after-passive'))).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('closes when the role loses the permission the stream needs', async () => {
    await ctx.prisma.roleTemplatePermission.delete({
      where: { roleTemplateId_permissionKey: { roleTemplateId: roleId, permissionKey: 'orders.view' } },
    });
    const stream = await open(bearer(staffToken)).catch(() => null);
    expect(stream).toBeNull();
    await ctx.prisma.roleTemplatePermission.create({ data: { roleTemplateId: roleId, permissionKey: 'orders.view' } });
    const live = await open(bearer(staffToken));
    try {
      await ctx.prisma.roleTemplatePermission.delete({
        where: { roleTemplateId_permissionKey: { roleTemplateId: roleId, permissionKey: 'orders.view' } },
      });
      expect(await live.waitForEnd(5000)).toBe(true);
    } finally {
      live.close();
      await ctx.prisma.roleTemplatePermission.upsert({
        where: { roleTemplateId_permissionKey: { roleTemplateId: roleId, permissionKey: 'orders.view' } },
        create: { roleTemplateId: roleId, permissionKey: 'orders.view' },
        update: {},
      });
    }
  });

  it('masks customer numbers as soon as the role loses contact access', async () => {
    const stream = await open(bearer(staffToken));
    try {
      await ctx.prisma.roleTemplatePermission.delete({
        where: { roleTemplateId_permissionKey: { roleTemplateId: roleId, permissionKey: 'customers.contact.view' } },
      });
      await sleep(2500);
      publishOrder('after-contact-loss');
      const frame = await stream.waitForFrame('after-contact-loss', 3000);
      expect(frame).not.toBeNull();
      expect(frame).not.toContain(customerPhone);
    } finally {
      stream.close();
    }
  });

  it('closes when the access token it was opened with expires', async () => {
    const jwt = ctx.app.get(JwtService);
    const shortLived = await jwt.signAsync(
      { sub: staffUserId, phone: staffPhone, isSuperAdmin: false, type: 'access' },
      { expiresIn: 2 },
    );
    const stream = await open(bearer(shortLived));
    try {
      expect(await stream.waitForEnd(6000)).toBe(true);
    } finally {
      stream.close();
    }
  });

  it('closes when the session signs out', async () => {
    const token = await ctx.login(staffPhone);
    const stream = await open(bearer(token));
    try {
      await ctx.http().post('/auth/logout').set(bearer(token)).expect(204);
      expect(await stream.waitForEnd(5000)).toBe(true);
    } finally {
      stream.close();
    }
  });

  it('closes when the API key it was opened with is revoked', async () => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/api-keys`)
      .set(bearer(ownerToken, restaurantId))
      .send({ name: 'E2E Akis anahtari', permissions: ['orders.view'] })
      .expect(201);
    const stream = await open({ [API_KEY_HEADER]: created.body.token as string });
    try {
      await sleep(1500);
      expect(stream.ended()).toBe(false);
      await ctx
        .http()
        .post(`/restaurants/${restaurantId}/api-keys/${created.body.id as string}/revoke`)
        .set(bearer(ownerToken, restaurantId))
        .expect(200);
      expect(await stream.waitForEnd(5000)).toBe(true);
    } finally {
      stream.close();
    }
  });
});
