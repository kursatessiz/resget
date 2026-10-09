import { createHash, randomBytes } from 'node:crypto';
import { normalizePhone } from '@resget/shared';
import type { ConsentRegistryAdapter } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { CampaignsRunner } from '../../src/modules/campaigns/campaigns.runner';
import { CONSENT_REGISTRY } from '../../src/modules/campaigns/consent-registry';

const TAG = 'consent-e2e';
const LEGACY = normalizePhone('05329990981')!;
const IGNORED = normalizePhone('05329990982')!;
const WHATSAPP_ONLY = normalizePhone('05329990983')!;
const GERMAN = normalizePhone('+4915112349984')!;
const MERCHANT = normalizePhone('05329990985')!;
const GUEST = normalizePhone('05329990986')!;
const OTHER_NUMBER = normalizePhone('05329990987')!;
const GERMAN_VERIFIED = normalizePhone('+4915112349987')!;
const GERMAN_STRICT = normalizePhone('+4915112349988')!;
const PHONES = [LEGACY, IGNORED, WHATSAPP_ONLY, GERMAN, MERCHANT, GUEST, OTHER_NUMBER, GERMAN_VERIFIED, GERMAN_STRICT];

/** Consent v2 (docs/RIZA.md): per-channel boxes, effective channel, caps, double opt-in, opt-outs, merchant exemption. */
describe('Consent v2 (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let itemId: string;
  let runner: CampaignsRunner;
  let originalTimezone: string;
  const walletBalances = new Map<string, number>();
  const campaignIds: string[] = [];
  const orderIds: string[] = [];
  const client = `10.88.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  const tomorrowNoon = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  };
  const setSwitch = (key: string, enabled: boolean | null) =>
    ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/${key}`)
      .set(bearer(adminToken))
      .send({ enabled })
      .expect(200);
  /** `signedInAs`: the number whose session places the order; consent for it counts at once (docs/RIZA.md). */
  const order = async (phone: string, consent: Record<string, unknown>, signedInAs: string | null = null) => {
    const token = signedInAs ? await ctx.login(signedInAs) : null;
    const req = ctx.http().post(`/public/restaurants/${SEED.restaurantSlug}/orders`).set('x-forwarded-for', client);
    const res = await (token ? req.set(bearer(token)) : req)
      .send({
        fulfillment: 'PICKUP',
        items: [{ menuItemId: itemId, quantity: 1 }],
        customer: { fullName: 'Riza Musteri', phone },
        payment: { method: 'CASH_ON_DELIVERY' },
        ...consent,
      })
      .expect(201);
    const row = await ctx.prisma.order.findUniqueOrThrow({
      where: { trackingToken: res.body.trackingToken as string },
      select: { id: true },
    });
    orderIds.push(row.id);
    const customer = await ctx.prisma.restaurantCustomer.update({
      where: { restaurantId_userId: { restaurantId, userId: (await userId(phone))! } },
      data: { tags: [TAG] },
      select: { id: true, consentChannels: true },
    });
    return customer;
  };
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUnique({ where: { phone }, select: { id: true } }))?.id ?? null;
  const customerOf = (phone: string) =>
    ctx.prisma.restaurantCustomer.findFirstOrThrow({
      where: { restaurantId, user: { phone } },
      select: { id: true, consentChannels: true, marketingOptIn: true, marketingToken: true },
    });
  const campaign = async (channel: 'SMS' | 'WHATSAPP') => {
    const created = await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns`)
      .set(bearer(ownerToken))
      .send({ name: `Riza ${channel}`, channel, body: 'Riza denemesi.', segment: { tags: [TAG] } })
      .expect(201);
    campaignIds.push(created.body.id);
    await ctx
      .http()
      .post(`/restaurants/${restaurantId}/campaigns/${created.body.id}/send`)
      .set(bearer(ownerToken))
      .send({})
      .expect(200);
    await runner.tick(tomorrowNoon());
    const recipients = await ctx.prisma.campaignRecipient.findMany({
      where: { campaignId: created.body.id },
      select: { status: true, errorCode: true, customer: { select: { user: { select: { phone: true } } } } },
    });
    return new Map(recipients.map((r) => [r.customer.user.phone, r]));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    runner = ctx.app.get(CampaignsRunner);
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true, timezone: true, countryCode: true },
    });
    expect(restaurant.countryCode).toBe('TR');
    restaurantId = restaurant.id;
    originalTimezone = restaurant.timezone;
    itemId = (
      await ctx.prisma.menuItem.findFirstOrThrow({ where: { restaurantId, isAvailable: true }, select: { id: true } })
    ).id;
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: 'Etc/UTC' } });
    for (const wallet of await ctx.prisma.messageWallet.findMany({ where: { restaurantId } })) {
      walletBalances.set(wallet.id, wallet.balance);
      await ctx.prisma.messageWallet.update({ where: { id: wallet.id }, data: { balance: 100 } });
    }
  });

  afterAll(async () => {
    if (campaignIds.length) await ctx.prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    if (orderIds.length) await ctx.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { restaurantId, user: { phone: { in: PHONES } } } });
    await ctx.prisma.user.deleteMany({ where: { phone: { in: PHONES } } });
    await ctx.prisma.marketingSettings.deleteMany({ where: { restaurantId } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['consent_v2', 'whatsapp_channel'] } },
    });
    await ctx.prisma.restaurant.update({ where: { id: restaurantId }, data: { timezone: originalTimezone } });
    for (const [id, balance] of walletBalances)
      await ctx.prisma.messageWallet.update({ where: { id }, data: { balance } });
    await ctx.close();
  });

  it('with the module off, the legacy box means both channels and per-channel boxes are ignored', async () => {
    const legacy = await order(LEGACY, { marketingOptIn: true }, LEGACY);
    expect([...legacy.consentChannels].sort()).toEqual(['SMS', 'WHATSAPP']);
    const rows = await ctx.prisma.contactConsent.findMany({ where: { customerId: legacy.id } });
    expect(rows.map((r) => [r.channel, r.granted, r.source]).sort()).toEqual([
      ['SMS', true, 'ORDER_CHECKBOX'],
      ['WHATSAPP', true, 'ORDER_CHECKBOX'],
    ]);
    const ignored = await order(IGNORED, { marketingChannels: ['WHATSAPP'] });
    expect(ignored.consentChannels).toEqual([]);
    expect(await ctx.prisma.contactConsent.count({ where: { customerId: ignored.id } })).toBe(0);

    // A guest's number is unproved: even with the module off and in Turkey, the box waits for the SMS link.
    const guest = await order(GUEST, { marketingOptIn: true });
    expect(guest.consentChannels).toEqual([]);
    const pending = await ctx.prisma.contactConsent.findMany({ where: { customerId: guest.id } });
    expect(pending).toHaveLength(2);
    expect(pending.every((r) => r.granted && r.confirmationRequestedAt !== null && r.confirmedAt === null)).toBe(true);
    expect(await ctx.prisma.consentConfirmation.count({ where: { customerId: guest.id } })).toBe(1);
  });

  it('with the module on, only the ticked channel counts and a WhatsApp consent never becomes an SMS', async () => {
    await setSwitch('consent_v2', true);
    const menu = await ctx.http().get(`/public/restaurants/${SEED.restaurantSlug}/menu`).expect(200);
    expect(menu.body.consentV2).toBe(true);
    const whatsappOnly = await order(WHATSAPP_ONLY, { marketingChannels: ['WHATSAPP'] }, WHATSAPP_ONLY);
    expect(whatsappOnly.consentChannels).toEqual(['WHATSAPP']);

    // WhatsApp switched off: the campaign goes as SMS, so only SMS consent reaches it.
    await setSwitch('whatsapp_channel', false);
    const asSms = await campaign('WHATSAPP');
    expect(asSms.has(WHATSAPP_ONLY)).toBe(false);
    expect(asSms.get(LEGACY)?.status).toBe('SENT');
    await setSwitch('whatsapp_channel', null);

    // WhatsApp on again: both are reachable; the legacy customer already had today's one message.
    const onWhatsapp = await campaign('WHATSAPP');
    expect(onWhatsapp.get(WHATSAPP_ONLY)?.status).toBe('SENT');
    expect(onWhatsapp.get(LEGACY)).toMatchObject({ status: 'SKIPPED', errorCode: 'FREQUENCY_CAP' });
  });

  it('counts a verified number at once, unless the owner listed its region or the order is for another number', async () => {
    const verified = await order(GERMAN_VERIFIED, { marketingChannels: ['SMS'] }, GERMAN_VERIFIED);
    expect(verified.consentChannels).toEqual(['SMS']);
    const forSomeoneElse = await order(OTHER_NUMBER, { marketingChannels: ['SMS'] }, WHATSAPP_ONLY);
    expect(forSomeoneElse.consentChannels).toEqual([]);
    expect(await ctx.prisma.consentConfirmation.count({ where: { customerId: forSomeoneElse.id } })).toBe(1);

    const policy = `/admin/restaurants/${restaurantId}/consent-policy`;
    await ctx
      .http()
      .put(policy)
      .set(bearer(adminToken))
      .send({ doubleOptInRegions: ['EU_UK'], merchantExemption: false })
      .expect(200);
    const strict = await order(GERMAN_STRICT, { marketingChannels: ['SMS'] }, GERMAN_STRICT);
    expect(strict.consentChannels).toEqual([]);
    await ctx
      .http()
      .put(policy)
      .set(bearer(adminToken))
      .send({ doubleOptInRegions: [], merchantExemption: false })
      .expect(200);
  });

  it('keeps the consent of an unverified number waiting until the link is pressed, once', async () => {
    const german = await order(GERMAN, { marketingChannels: ['SMS'] });
    expect(german.consentChannels).toEqual([]);
    const [row] = await ctx.prisma.contactConsent.findMany({ where: { customerId: german.id } });
    expect(row).toMatchObject({ channel: 'SMS', granted: true, confirmedAt: null });
    expect(row.confirmationRequestedAt).not.toBeNull();
    expect(row.registrySyncedAt).toBeNull();
    expect(await ctx.prisma.consentConfirmation.count({ where: { customerId: german.id } })).toBe(1);
    expect(
      await ctx.prisma.messageLog.count({ where: { restaurantId, templateKey: 'consent.confirm', creditsCharged: 0 } }),
    ).toBeGreaterThanOrEqual(1);

    // The SMS text is not readable here; a link of our own stands in for it.
    const token = randomBytes(32).toString('base64url');
    await ctx.prisma.consentConfirmation.create({
      data: {
        restaurantId,
        customerId: german.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const confirmed = await ctx.http().post(`/public/consent/confirm/${token}`).expect(200);
    expect(confirmed.body).toEqual({ status: 'CONFIRMED', restaurantName: expect.any(String) });
    expect((await customerOf(GERMAN)).consentChannels).toEqual(['SMS']);
    const again = await ctx.http().post(`/public/consent/confirm/${token}`).expect(200);
    expect(again.body).toEqual({ status: 'INVALID' });
    await ctx.http().post(`/public/consent/confirm/not-a-token`).expect(400);
  });

  it('lets the opt-out link refuse every channel and staff record a refusal, never a yes', async () => {
    const legacy = await customerOf(LEGACY);
    await ctx.http().post(`/public/marketing/opt-out/${legacy.marketingToken}`).expect(200);
    const after = await customerOf(LEGACY);
    expect(after).toMatchObject({ consentChannels: [], marketingOptIn: false });
    const refusals = await ctx.prisma.contactConsent.findMany({
      where: { customerId: legacy.id, granted: false, source: 'OPT_OUT_LINK' },
    });
    expect(refusals.map((r) => r.channel).sort()).toEqual(['CALL', 'EMAIL', 'SMS', 'WHATSAPP']);

    const whatsappOnly = await customerOf(WHATSAPP_ONLY);
    const base = `/restaurants/${restaurantId}/consent/customers/${whatsappOnly.id}`;
    await ctx
      .http()
      .post(`${base}/opt-out`)
      .set(bearer(ownerToken, restaurantId))
      .send({ channels: ['WHATSAPP'] })
      .expect(400);
    const recorded = await ctx
      .http()
      .post(`${base}/opt-out`)
      .set(bearer(ownerToken, restaurantId))
      .send({ channels: ['WHATSAPP'], note: 'Telefonda istemedigini soyledi' })
      .expect(200);
    expect(recorded.body.effective).toEqual([]);
    expect(recorded.body.current).toEqual([
      expect.objectContaining({ channel: 'WHATSAPP', granted: false, source: 'STAFF_OPT_OUT' }),
    ]);
    expect(recorded.body.history).toHaveLength(2);
  });

  it('writes and registers the merchant exemption for a Turkish business, and stops counting it when switched off', async () => {
    const merchant = await order(MERCHANT, {});
    const registry = ctx.app.get<ConsentRegistryAdapter>(CONSENT_REGISTRY);
    const recorded = jest.spyOn(registry, 'record');
    try {
      const base = `/restaurants/${restaurantId}/consent/customers/${merchant.id}`;
      // A business without the switch: nothing to send to.
      const plain = await ctx
        .http()
        .put(`${base}/business`)
        .set(bearer(ownerToken, restaurantId))
        .send({ isBusiness: true })
        .expect(200);
      expect(plain.body.effective).toEqual([]);
      // Only the platform owner turns the exemption on.
      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/consent-policy`)
        .set(bearer(ownerToken))
        .send({ doubleOptInRegions: ['EU_UK'], merchantExemption: true })
        .expect(403);
      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/consent-policy`)
        .set(bearer(adminToken))
        .send({ doubleOptInRegions: ['EU_UK'], merchantExemption: true })
        .expect(200);
      const exempt = await ctx.http().get(base).set(bearer(ownerToken, restaurantId)).expect(200);
      expect(exempt.body.effective).toEqual(['SMS', 'CALL', 'EMAIL']);
      expect(
        (exempt.body.current as { legalBasis: string; registrySyncedAt: string | null }[]).every(
          (c) => c.legalBasis === 'TR_MERCHANT_EXEMPTION' && c.registrySyncedAt !== null,
        ),
      ).toBe(true);
      expect(recorded).toHaveBeenCalledWith(
        expect.objectContaining({ phone: MERCHANT, recipientType: 'MERCHANT', granted: true }),
      );
      expect(recorded.mock.calls.some(([entry]) => entry.channel === 'WHATSAPP')).toBe(false);

      await ctx
        .http()
        .put(`/admin/restaurants/${restaurantId}/consent-policy`)
        .set(bearer(adminToken))
        .send({ doubleOptInRegions: ['EU_UK'], merchantExemption: false })
        .expect(200);
      expect((await customerOf(MERCHANT)).consentChannels).toEqual([]);
    } finally {
      recorded.mockRestore();
    }
  });

  it('keeps the restaurant limits in range and is off with the module', async () => {
    const path = `/restaurants/${restaurantId}/consent/settings`;
    await ctx.http().put(path).set(bearer(ownerToken, restaurantId)).send({ dailyCap: 5, weeklyCap: 6 }).expect(400);
    const saved = await ctx
      .http()
      .put(path)
      .set(bearer(ownerToken, restaurantId))
      .send({ dailyCap: 2, weeklyCap: 4 })
      .expect(200);
    expect(saved.body.policy).toMatchObject({ dailyCap: 2, weeklyCap: 4, merchantExemption: false });
    await setSwitch('consent_v2', null);
    await ctx
      .http()
      .get(path)
      .set(bearer(ownerToken, restaurantId))
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
  });
});
