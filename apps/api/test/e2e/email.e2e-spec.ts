import { normalizePhone } from '@resget/shared';
import { SEED, bearer, createTestApp } from './support/app';
import type { TestContext } from './support/app';
import { EMAIL_PROVIDER, MockEmailProvider } from '../../src/modules/email/email.provider';
import { EmailService } from '../../src/modules/email/email.service';
import { SnsVerifier } from '../../src/modules/email/sns-verifier';
import { ConsentService } from '../../src/modules/consent/consent.service';

const TOPIC = 'arn:aws:sns:eu-central-1:123456789012:resget-ses-feedback';
const DOMAIN = 'lokanta-e2e.verified.test';
const CONTACT_PHONE = normalizePhone('05329990991')!;
const CONTACT_EMAIL = 'musteri.e2e@ornek.test';

/** Email channel (docs/EPOSTA.md): sending domains, test send, suppression, SNS feedback, commercial rules. */
describe('Email channel (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let ownerToken: string;
  let restaurantId: string;
  let otherRestaurantId: string;
  let outbox: MockEmailProvider['outbox'];
  let verifier: SnsVerifier;
  const base = () => `/restaurants/${restaurantId}/email`;
  const sns = (type: string, message: unknown, topic = TOPIC) =>
    ctx
      .http()
      .post('/webhooks/email/ses')
      .set('content-type', 'text/plain; charset=UTF-8')
      .send(
        JSON.stringify({
          Type: type,
          MessageId: `m-${Math.random()}`,
          TopicArn: topic,
          Message: JSON.stringify(message),
          Timestamp: new Date().toISOString(),
          SignatureVersion: '2',
          Signature: 'c2lnbmF0dXJl',
          SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-abc.pem',
        }),
      );

  beforeAll(async () => {
    process.env.SES_SNS_TOPIC_ARNS = TOPIC;
    ctx = await createTestApp();
    [adminToken, ownerToken] = await Promise.all([ctx.login(SEED.superAdminPhone), ctx.login(SEED.ownerPhone)]);
    const restaurant = await ctx.prisma.restaurant.findUniqueOrThrow({
      where: { slug: SEED.restaurantSlug },
      select: { id: true },
    });
    restaurantId = restaurant.id;
    otherRestaurantId = (
      await ctx.prisma.restaurant.create({
        data: {
          slug: `eposta-e2e-${Date.now().toString(36)}`,
          name: 'Eposta Diger',
          countryCode: 'TR',
          currency: 'TRY',
          timezone: 'Europe/Istanbul',
        },
        select: { id: true },
      })
    ).id;
    outbox = ctx.app.get<MockEmailProvider>(EMAIL_PROVIDER).outbox;
    verifier = ctx.app.get(SnsVerifier);
    await ctx.prisma.emailDomain.deleteMany({ where: { domain: { in: [DOMAIN, 'yok-e2e.example'] } } });
    await ctx.prisma.emailSuppression.deleteMany({ where: { email: { endsWith: '@ornek.test' } } });
    await ctx.prisma.user.deleteMany({ where: { phone: CONTACT_PHONE } });
  });

  afterAll(async () => {
    await ctx.prisma.emailDomain.deleteMany({ where: { domain: { in: [DOMAIN, 'yok-e2e.example'] } } });
    await ctx.prisma.emailSuppression.deleteMany({ where: { email: { endsWith: '@ornek.test' } } });
    await ctx.prisma.restaurantCustomer.deleteMany({ where: { user: { phone: CONTACT_PHONE } } });
    await ctx.prisma.user.deleteMany({ where: { phone: CONTACT_PHONE } });
    await ctx.prisma.featureFlag.deleteMany({
      where: { restaurantId, key: { in: ['email_channel', 'consent_v2'] } },
    });
    await ctx.prisma.restaurant.delete({ where: { id: otherRestaurantId } });
    delete process.env.SES_SNS_TOPIC_ARNS;
    await ctx.close();
  });

  it('is behind its switch, then verifies a domain once SPF, DKIM and DMARC are published', async () => {
    await ctx
      .http()
      .get(base())
      .set(bearer(ownerToken, restaurantId))
      .expect(403)
      .expect('x-error-code', 'FEATURE_DISABLED');
    await ctx
      .http()
      .put(`/admin/restaurants/${restaurantId}/features/email_channel`)
      .set(bearer(adminToken))
      .send({ enabled: true })
      .expect(200);

    const missing = await ctx
      .http()
      .post(`${base()}/domains`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: 'yok-e2e.example', fromLocalPart: 'bilgi', fromName: 'Demo Lokanta' })
      .expect(201);
    const checkedMissing = await ctx
      .http()
      .post(`${base()}/domains/${missing.body.id}/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(checkedMissing.body).toMatchObject({ status: 'PENDING', spfStatus: 'MISSING', dkimStatus: 'MISSING' });
    await ctx.http().delete(`${base()}/domains/${missing.body.id}`).set(bearer(ownerToken, restaurantId)).expect(204);

    const added = await ctx
      .http()
      .post(`${base()}/domains`)
      .set(bearer(ownerToken, restaurantId))
      .send({ domain: DOMAIN, fromLocalPart: 'bilgi', fromName: 'Demo Lokanta' })
      .expect(201);
    expect(added.body.records).toHaveLength(5);
    expect(added.body.records.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    const verified = await ctx
      .http()
      .post(`${base()}/domains/${added.body.id}/verify`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
    expect(verified.body).toMatchObject({
      status: 'VERIFIED',
      spfStatus: 'VALID',
      dkimStatus: 'VALID',
      dmarcStatus: 'VALID',
      fromAddress: `bilgi@${DOMAIN}`,
    });

    // A domain belongs to one tenant only.
    await expect(
      ctx.app
        .get(EmailService)
        .addDomain(otherRestaurantId, { domain: DOMAIN, fromLocalPart: 'bilgi', fromName: 'Baska' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EMAIL_DOMAIN_TAKEN' }) });
  });

  it('sends a test from the verified domain and never to a suppressed address', async () => {
    const before = outbox.length;
    const sent = await ctx
      .http()
      .post(`${base()}/test`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to: 'Deneme.E2E@Ornek.test' })
      .expect(200);
    expect(sent.body).toEqual({ status: 'SENT', errorCode: null });
    const mail = outbox[outbox.length - 1];
    expect(outbox.length).toBe(before + 1);
    expect(mail).toMatchObject({ from: `bilgi@${DOMAIN}`, to: 'deneme.e2e@ornek.test' });
    expect(mail.text).toContain('Demo Lokanta');
    expect(mail.html).not.toContain('<script');
    expect(mail.headers['List-Unsubscribe']).toBeUndefined();

    const listed = await ctx
      .http()
      .post(`${base()}/suppressions`)
      .set(bearer(ownerToken, restaurantId))
      .send({ email: 'deneme.e2e@ornek.test' })
      .expect(201);
    expect(listed.body).toEqual([expect.objectContaining({ email: 'deneme.e2e@ornek.test', reason: 'UNSUBSCRIBE' })]);
    const blocked = await ctx
      .http()
      .post(`${base()}/test`)
      .set(bearer(ownerToken, restaurantId))
      .send({ to: 'deneme.e2e@ornek.test' })
      .expect(200);
    expect(blocked.body).toEqual({ status: 'SKIPPED', errorCode: 'SUPPRESSED_UNSUBSCRIBE' });
    expect(outbox.length).toBe(before + 1);
    const log = await ctx.prisma.messageLog.findFirstOrThrow({
      where: { restaurantId, channel: 'EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toMatchObject({ toMasked: 'd***@ornek.test', creditsCharged: 0, errorCode: 'SUPPRESSED_UNSUBSCRIBE' });

    await ctx
      .http()
      .delete(`${base()}/suppressions/${listed.body[0].id}`)
      .set(bearer(ownerToken, restaurantId))
      .expect(200);
  });

  it('reads only signed SNS messages from its topics: a hard bounce silences everyone, a complaint the sender', async () => {
    const verify = jest.spyOn(verifier, 'verify');
    try {
      verify.mockResolvedValue(false);
      await sns('Notification', {
        eventType: 'Bounce',
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'sahte.e2e@ornek.test' }] },
        mail: { messageId: 'x' },
      }).expect(204);
      await sns(
        'Notification',
        {
          eventType: 'Bounce',
          bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'sahte.e2e@ornek.test' }] },
        },
        'arn:aws:sns:eu-central-1:999:other',
      ).expect(204);
      expect(await ctx.prisma.emailSuppression.count({ where: { email: 'sahte.e2e@ornek.test' } })).toBe(0);
      await ctx.http().post('/webhooks/email/ses').set('content-type', 'text/plain').send('not json').expect(400);

      verify.mockResolvedValue(true);
      await sns('Notification', {
        eventType: 'Bounce',
        bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'gecici.e2e@ornek.test' }] },
        mail: { messageId: 'y' },
      }).expect(204);
      await sns('Notification', {
        eventType: 'Bounce',
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'Yok.E2E@ornek.test' }] },
        mail: { messageId: 'z' },
      }).expect(204);
      expect(await ctx.prisma.emailSuppression.count({ where: { email: 'gecici.e2e@ornek.test' } })).toBe(0);
      expect(
        await ctx.prisma.emailSuppression.findFirstOrThrow({ where: { email: 'yok.e2e@ornek.test' } }),
      ).toMatchObject({ restaurantId: null, reason: 'BOUNCE' });
      // Global: another restaurant cannot mail it either.
      const email = ctx.app.get(EmailService);
      expect(await email.isSuppressed(otherRestaurantId, 'yok.e2e@ornek.test')).toBe('BOUNCE');

      // A complaint about a message we sent belongs to its sender.
      await ctx
        .http()
        .post(`${base()}/test`)
        .set(bearer(ownerToken, restaurantId))
        .send({ to: 'sikayet.e2e@ornek.test' })
        .expect(200);
      const sentLog = await ctx.prisma.messageLog.findFirstOrThrow({
        where: { restaurantId, channel: 'EMAIL', status: 'SENT' },
        orderBy: { createdAt: 'desc' },
      });
      await sns('Notification', {
        notificationType: 'Complaint',
        complaint: { complainedRecipients: [{ emailAddress: 'sikayet.e2e@ornek.test' }] },
        mail: { messageId: sentLog.providerRef },
      }).expect(204);
      const complaint = await ctx.prisma.emailSuppression.findFirstOrThrow({
        where: { email: 'sikayet.e2e@ornek.test' },
      });
      expect(complaint).toMatchObject({ restaurantId, reason: 'COMPLAINT' });
      expect(await email.isSuppressed(otherRestaurantId, 'sikayet.e2e@ornek.test')).toBeNull();
      const listed = await ctx.http().get(base()).set(bearer(ownerToken, restaurantId)).expect(200);
      const entry = (listed.body.suppressions as { id: string; email: string }[]).find(
        (s) => s.email === 'sikayet.e2e@ornek.test',
      );
      await ctx
        .http()
        .delete(`${base()}/suppressions/${entry?.id}`)
        .set(bearer(ownerToken, restaurantId))
        .expect(409)
        .expect('x-error-code', 'SUPPRESSION_LOCKED');
    } finally {
      verify.mockRestore();
    }
  });

  it('sends commercial mail only with EMAIL consent, an unsubscribe header and the postal address', async () => {
    const user = await ctx.prisma.user.create({ data: { phone: CONTACT_PHONE, fullName: 'Eposta Musteri' } });
    const contact = await ctx.prisma.restaurantCustomer.create({
      data: { restaurantId, userId: user.id, email: CONTACT_EMAIL },
      select: { id: true },
    });
    const email = ctx.app.get(EmailService);
    const request = {
      restaurantId,
      to: CONTACT_EMAIL,
      kind: 'COMMERCIAL' as const,
      templateKey: 'test' as const,
      locale: 'tr',
      customerId: contact.id,
      unsubscribeUrl: 'https://resget.test/iptal/abc',
    };
    expect(await email.send(request)).toMatchObject({ status: 'SKIPPED', errorCode: 'NO_CONSENT' });

    await ctx.app
      .get(ConsentService)
      .grant({ restaurantId, customerId: contact.id, channels: ['EMAIL'], source: 'SITE_FORM' });
    const before = outbox.length;
    expect(await email.send(request)).toMatchObject({ status: 'SENT', errorCode: null });
    const mail = outbox[before];
    expect(mail.headers).toMatchObject({
      'List-Unsubscribe': '<https://resget.test/iptal/abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(mail.text).toContain('https://resget.test/iptal/abc');

    // A complaint or a manual unsubscribe also refuses the EMAIL consent.
    await ctx
      .http()
      .post(`${base()}/suppressions`)
      .set(bearer(ownerToken, restaurantId))
      .send({ email: CONTACT_EMAIL })
      .expect(201);
    const after = await ctx.prisma.restaurantCustomer.findUniqueOrThrow({
      where: { id: contact.id },
      select: { consentChannels: true },
    });
    expect(after.consentChannels).not.toContain('EMAIL');
  });
});
