import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_LOCALE,
  BUNDLED_MESSAGES,
  createTranslator,
  evaluateEmailDomainDns,
  expectedEmailDomainRecords,
  maskEmail,
  normalizeEmail,
  plainTextToHtml,
} from '@resget/shared';
import type {
  AddEmailDomainInput,
  DnsRecordStatus,
  EmailDomainDTO,
  EmailDomainStatus,
  EmailKind,
  EmailSettingsDTO,
  EmailSuppressionDTO,
  EmailSuppressionReason,
  EmailTemplateKey,
} from '@resget/shared';
import type { Prisma } from '@resget/database';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { ConsentService } from '../consent/consent.service';
import { badRequest, conflict, notFound } from '../../common/api-error';
import { EMAIL_PROVIDER } from './email.provider';
import type { EmailProvider } from './email.provider';
import { EMAIL_DNS } from './email-dns';
import type { EmailDnsLookup } from './email-dns';

export interface SendEmailRequest {
  /** The sending tenant; null for platform mail. */
  restaurantId: string | null;
  to: string;
  kind: EmailKind;
  templateKey: EmailTemplateKey;
  params?: Record<string, string | number>;
  locale: string;
  /** Commercial mail: the contact whose EMAIL consent decides, and the one-click unsubscribe address. */
  customerId?: string;
  unsubscribeUrl?: string;
}

export interface SendEmailResult {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  errorCode: string | null;
  logId: string | null;
}

type DomainRow = Prisma.EmailDomainGetPayload<object>;

/**
 * The email channel (docs/EPOSTA.md). Before every send: the address must
 * not be suppressed (a hard bounce anywhere, a complaint or unsubscribe for
 * this sender); commercial mail needs the contact's EMAIL consent, the
 * sender's verified domain, a one-click unsubscribe and the sender's postal
 * address in the footer. Transactional mail without a verified domain goes
 * from the platform address under the restaurant's name. Every attempt is a
 * MessageLog row; email is never charged to a wallet.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly features: FeatureFlagsService,
    private readonly consent: ConsentService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    @Inject(EMAIL_DNS) private readonly dns: EmailDnsLookup,
  ) {}

  private platformFrom(): string | null {
    const configured = this.config.get<string>('SES_FROM_ADDRESS');
    if (configured) return configured;
    // The stand-in needs some address to record; it never leaves the process.
    return this.provider.code === 'MOCK' ? 'no-reply@mock.invalid' : null;
  }

  private translator(locale: string) {
    const messages = BUNDLED_MESSAGES[locale] ?? BUNDLED_MESSAGES[BASE_LOCALE];
    return createTranslator({ locale, messages, fallback: BUNDLED_MESSAGES[BASE_LOCALE] });
  }

  // -- Sending -------------------------------------------------------------------------

  async isSuppressed(restaurantId: string | null, email: string): Promise<EmailSuppressionReason | null> {
    const row = await this.prisma.emailSuppression.findFirst({
      where: {
        email,
        OR: [{ restaurantId: null }, ...(restaurantId ? [{ restaurantId }] : [])],
      },
      orderBy: { createdAt: 'asc' },
      select: { reason: true },
    });
    return (row?.reason as EmailSuppressionReason | undefined) ?? null;
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    const to = normalizeEmail(request.to);
    if (!to) return { status: 'FAILED', errorCode: 'INVALID_EMAIL', logId: null };
    const log = await this.prisma.messageLog.create({
      data: {
        restaurantId: request.restaurantId,
        channel: 'EMAIL',
        toMasked: maskEmail(to),
        templateKey: `email.${request.templateKey}`,
        provider: this.provider.code,
      },
      select: { id: true },
    });
    const finish = async (status: SendEmailResult['status'], errorCode: string | null, providerRef?: string | null) => {
      await this.prisma.messageLog.update({
        where: { id: log.id },
        data: {
          status: status === 'SENT' ? 'SENT' : 'FAILED',
          errorCode,
          providerRef: providerRef ?? null,
        },
      });
      return { status, errorCode, logId: log.id };
    };

    const suppressed = await this.isSuppressed(request.restaurantId, to);
    if (suppressed) return finish('SKIPPED', `SUPPRESSED_${suppressed}`);

    const restaurant = request.restaurantId
      ? await this.prisma.restaurant.findUnique({
          where: { id: request.restaurantId },
          select: {
            name: true,
            branches: {
              take: 1,
              orderBy: { createdAt: 'asc' },
              select: { addressLine: true, district: true, city: true },
            },
          },
        })
      : null;
    const domain = request.restaurantId ? await this.verifiedDomain(request.restaurantId) : null;
    const t = this.translator(request.locale);
    const params = { restaurant: restaurant?.name ?? '', ...request.params };
    const subject = t(`email.template.${request.templateKey}.subject`, params);
    let text = t(`email.template.${request.templateKey}.body`, params);
    const headers: Record<string, string> = {};

    if (request.kind === 'COMMERCIAL') {
      if (!request.restaurantId || !request.customerId || !request.unsubscribeUrl)
        return finish('FAILED', 'COMMERCIAL_CONTEXT_MISSING');
      if (!domain) return finish('SKIPPED', 'EMAIL_DOMAIN_NOT_VERIFIED');
      const check = (await this.consent.checkRecipients(request.restaurantId, 'EMAIL', [request.customerId])).get(
        request.customerId,
      );
      if (check !== null && check !== undefined) return finish('SKIPPED', check);
      const branch = restaurant?.branches[0];
      const address = branch ? [branch.addressLine, branch.district, branch.city].filter(Boolean).join(', ') : '';
      text = `${text}\n\n${t('email.footer.commercial', { restaurant: restaurant?.name ?? '', address, url: request.unsubscribeUrl })}`;
      headers['List-Unsubscribe'] = `<${request.unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    } else if (restaurant) {
      text = `${text}\n\n${t('email.footer.transactional', { restaurant: restaurant.name })}`;
    }

    const from = domain ? `${domain.fromLocalPart}@${domain.domain}` : this.platformFrom();
    if (!from) return finish('FAILED', 'EMAIL_NOT_CONFIGURED');
    const result = await this.provider.send({
      from,
      fromName: domain?.fromName ?? restaurant?.name ?? 'Resget',
      to,
      subject,
      text,
      html: plainTextToHtml(text),
      headers,
    });
    return finish(result.status, result.errorCode, result.providerRef);
  }

  async sendTest(restaurantId: string, to: string): Promise<SendEmailResult> {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { defaultLocale: true },
    });
    return this.send({
      restaurantId,
      to,
      kind: 'TRANSACTIONAL',
      templateKey: 'test',
      locale: restaurant.defaultLocale,
    });
  }

  // -- Domains -------------------------------------------------------------------------

  private async verifiedDomain(restaurantId: string): Promise<DomainRow | null> {
    return this.prisma.emailDomain.findFirst({
      where: { restaurantId, status: 'VERIFIED' },
      orderBy: { verifiedAt: 'asc' },
    });
  }

  private toDomain(row: DomainRow): EmailDomainDTO {
    const records = expectedEmailDomainRecords(row.domain, row.dkimTokens);
    const statuses: Record<string, DnsRecordStatus> = {
      SPF: row.spfStatus as DnsRecordStatus,
      DMARC: row.dmarcStatus as DnsRecordStatus,
      DKIM: row.dkimStatus as DnsRecordStatus,
    };
    return {
      id: row.id,
      domain: row.domain,
      fromAddress: `${row.fromLocalPart}@${row.domain}`,
      fromName: row.fromName,
      status: row.status as EmailDomainStatus,
      spfStatus: row.spfStatus as DnsRecordStatus,
      dkimStatus: row.dkimStatus as DnsRecordStatus,
      dmarcStatus: row.dmarcStatus as DnsRecordStatus,
      dmarcPolicy: row.dmarcPolicy,
      records: records.map((r) => ({ ...r, status: statuses[r.kind] ?? 'PENDING' })),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      lastError: row.lastError,
    };
  }

  async addDomain(restaurantId: string, input: AddEmailDomainInput): Promise<EmailDomainDTO> {
    const platformHost = (this.config.get<string>('WEB_DOMAIN') ?? '').toLowerCase();
    if (platformHost && (input.domain === platformHost || input.domain.endsWith(`.${platformHost}`)))
      throw badRequest('EMAIL_DOMAIN_RESERVED', 'The platform domain cannot be a sender domain');
    const taken = await this.prisma.emailDomain.findUnique({ where: { domain: input.domain }, select: { id: true } });
    if (taken) throw conflict('EMAIL_DOMAIN_TAKEN', 'Domain already registered');
    const identity = await this.provider.createIdentity(input.domain);
    const row = await this.prisma.emailDomain.create({
      data: {
        restaurantId,
        domain: input.domain,
        fromLocalPart: input.fromLocalPart,
        fromName: input.fromName,
        dkimTokens: identity.dkimTokens,
      },
    });
    return this.toDomain(row);
  }

  /** Reads the published records and marks the domain verified once SPF, DKIM and DMARC all hold. */
  async verifyDomain(restaurantId: string, domainId: string): Promise<EmailDomainDTO> {
    const row = await this.prisma.emailDomain.findFirst({ where: { id: domainId, restaurantId } });
    if (!row) throw notFound('NOT_FOUND', 'Domain not found');
    let lastError: string | null = null;
    const read = async (fn: () => Promise<string[]>): Promise<string[]> => {
      try {
        return await fn();
      } catch (error) {
        lastError = `DNS: ${(error as { code?: string }).code ?? 'ERROR'}`;
        return [];
      }
    };
    const dkimCnames: Record<string, string[]> = {};
    for (const token of row.dkimTokens) {
      dkimCnames[token] = await read(() => this.dns.resolveCname(`${token}._domainkey.${row.domain}`));
    }
    const evaluation = evaluateEmailDomainDns(row.domain, row.dkimTokens, {
      domainTxt: await read(() => this.dns.resolveTxt(row.domain)),
      dmarcTxt: await read(() => this.dns.resolveTxt(`_dmarc.${row.domain}`)),
      dkimCnames,
    });
    const now = new Date();
    const updated = await this.prisma.emailDomain.update({
      where: { id: row.id },
      data: {
        spfStatus: evaluation.spfStatus,
        dkimStatus: evaluation.dkimStatus,
        dmarcStatus: evaluation.dmarcStatus,
        dmarcPolicy: evaluation.dmarcPolicy,
        status: evaluation.verified ? 'VERIFIED' : row.status === 'VERIFIED' ? 'FAILED' : 'PENDING',
        verifiedAt: evaluation.verified ? (row.verifiedAt ?? now) : null,
        lastCheckedAt: now,
        lastError,
      },
    });
    return this.toDomain(updated);
  }

  async removeDomain(restaurantId: string, domainId: string): Promise<void> {
    const row = await this.prisma.emailDomain.findFirst({ where: { id: domainId, restaurantId } });
    if (!row) throw notFound('NOT_FOUND', 'Domain not found');
    await this.provider.deleteIdentity(row.domain);
    await this.prisma.emailDomain.delete({ where: { id: row.id } });
  }

  // -- Suppressions --------------------------------------------------------------------

  private toSuppression(row: Prisma.EmailSuppressionGetPayload<object>): EmailSuppressionDTO {
    return {
      id: row.id,
      email: row.email,
      reason: row.reason as EmailSuppressionReason,
      global: row.restaurantId === null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Records a suppression once; a second identical one is a no-op. */
  async suppress(
    restaurantId: string | null,
    email: string,
    reason: EmailSuppressionReason,
    detail: string | null = null,
  ): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    const existing = await this.prisma.emailSuppression.findFirst({
      where: { restaurantId, email: normalized, reason },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.emailSuppression
      .create({ data: { restaurantId, email: normalized, reason, detail } })
      .catch(() => undefined);
  }

  async addSuppression(restaurantId: string, email: string): Promise<EmailSuppressionDTO[]> {
    await this.suppress(restaurantId, email, 'UNSUBSCRIBE', 'manual');
    await this.revokeEmailConsent(restaurantId, email, 'STAFF_OPT_OUT');
    return this.suppressions(restaurantId);
  }

  /** A tenant lifts only its own unsubscribe entries; bounces and complaints stay. */
  async removeSuppression(restaurantId: string, suppressionId: string): Promise<EmailSuppressionDTO[]> {
    const row = await this.prisma.emailSuppression.findFirst({ where: { id: suppressionId, restaurantId } });
    if (!row) throw notFound('NOT_FOUND', 'Suppression not found');
    if (row.reason !== 'UNSUBSCRIBE')
      throw conflict('SUPPRESSION_LOCKED', 'Bounces and complaints cannot be lifted by the sender');
    await this.prisma.emailSuppression.delete({ where: { id: row.id } });
    return this.suppressions(restaurantId);
  }

  async suppressions(restaurantId: string): Promise<EmailSuppressionDTO[]> {
    const rows = await this.prisma.emailSuppression.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.toSuppression(row));
  }

  /** A complaint or unsubscribe also refuses the EMAIL channel of the tenant's contacts with that address. */
  private async revokeEmailConsent(
    restaurantId: string,
    email: string,
    source: 'OPT_OUT_LINK' | 'STAFF_OPT_OUT',
  ): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    const contacts = await this.prisma.restaurantCustomer.findMany({
      where: { restaurantId, email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true },
    });
    for (const contact of contacts) await this.consent.revoke(contact.id, ['EMAIL'], source);
  }

  // -- Provider feedback ---------------------------------------------------------------

  /**
   * One SES event (bounce or complaint) from SNS. A permanent bounce silences
   * the address for everyone; a complaint silences it for the sender that
   * sent the message, found by the provider message id, and refuses the
   * EMAIL consent of that sender's contacts with the address.
   */
  async handleSesEvent(event: unknown): Promise<void> {
    if (!event || typeof event !== 'object') return;
    const e = event as Record<string, unknown>;
    const type = String(e.eventType ?? e.notificationType ?? '');
    const mail = (e.mail ?? {}) as { messageId?: string };
    const log = mail.messageId
      ? await this.prisma.messageLog.findFirst({
          where: { providerRef: mail.messageId, channel: 'EMAIL' },
          select: { restaurantId: true },
        })
      : null;
    if (type === 'Bounce') {
      const bounce = (e.bounce ?? {}) as { bounceType?: string; bouncedRecipients?: { emailAddress?: string }[] };
      if (bounce.bounceType !== 'Permanent') return;
      for (const r of bounce.bouncedRecipients ?? []) {
        if (r.emailAddress) await this.suppress(null, r.emailAddress, 'BOUNCE', mail.messageId ?? null);
      }
      return;
    }
    if (type === 'Complaint') {
      const complaint = (e.complaint ?? {}) as { complainedRecipients?: { emailAddress?: string }[] };
      for (const r of complaint.complainedRecipients ?? []) {
        if (!r.emailAddress) continue;
        await this.suppress(log?.restaurantId ?? null, r.emailAddress, 'COMPLAINT', mail.messageId ?? null);
        if (log?.restaurantId) await this.revokeEmailConsent(log.restaurantId, r.emailAddress, 'OPT_OUT_LINK');
      }
    }
  }

  allowedTopics(): string[] {
    return (this.config.get<string>('SES_SNS_TOPIC_ARNS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // -- Settings ------------------------------------------------------------------------

  async settings(restaurantId: string): Promise<EmailSettingsDTO> {
    const [enabled, domains, suppressions] = await Promise.all([
      this.features.isEnabled('email_channel', restaurantId),
      this.prisma.emailDomain.findMany({ where: { restaurantId }, orderBy: { createdAt: 'asc' } }),
      this.suppressions(restaurantId),
    ]);
    return {
      enabled,
      providerReady: this.provider.ready(),
      platformFromAddress: this.platformFrom(),
      domains: domains.map((d) => this.toDomain(d)),
      suppressions,
    };
  }

  logFailure(context: string, error: unknown): void {
    this.logger.warn(`${context}: ${String(error)}`);
  }
}
