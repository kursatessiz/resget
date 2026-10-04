import { z } from 'zod';

/**
 * Email channel (docs/EPOSTA.md): a restaurant sends from its own domain once
 * the domain's SPF, DKIM and DMARC records are in place; until then only
 * transactional mail goes out, from the platform's address with the
 * restaurant's name. A hard bounce silences an address everywhere; a
 * complaint or an unsubscribe silences it for that sender. Email is not
 * metered (no credits). Behind the email_channel module switch.
 */

export const EmailAddressSchema = z.string().trim().toLowerCase().max(254).email();

export function normalizeEmail(input: string): string | null {
  const parsed = EmailAddressSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Shown in logs and screens: the first letter and the domain. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}

// -- Sender domains --------------------------------------------------------------------

/** A registrable host name; no scheme, no path, at least one dot. */
export const SenderDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, 'domain');

export const AddEmailDomainSchema = z
  .object({
    domain: SenderDomainSchema,
    /** The part before the @ of the From address. */
    fromLocalPart: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    /** The display name; tenant data (the restaurant's name, usually). */
    fromName: z.string().trim().min(2).max(80),
  })
  .strict();
export type AddEmailDomainInput = z.infer<typeof AddEmailDomainSchema>;

export const DNS_RECORD_STATUSES = ['PENDING', 'VALID', 'INVALID', 'MISSING'] as const;
export type DnsRecordStatus = (typeof DNS_RECORD_STATUSES)[number];
export type DnsRecordKind = 'SPF' | 'DKIM' | 'DMARC';

export interface ExpectedDnsRecordDTO {
  kind: DnsRecordKind;
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
  status: DnsRecordStatus;
}

export const EMAIL_DOMAIN_STATUSES = ['PENDING', 'VERIFIED', 'FAILED'] as const;
export type EmailDomainStatus = (typeof EMAIL_DOMAIN_STATUSES)[number];

export interface EmailDomainDTO {
  id: string;
  domain: string;
  fromAddress: string;
  fromName: string;
  status: EmailDomainStatus;
  spfStatus: DnsRecordStatus;
  dkimStatus: DnsRecordStatus;
  dmarcStatus: DnsRecordStatus;
  dmarcPolicy: string | null;
  records: ExpectedDnsRecordDTO[];
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

/**
 * The records the domain owner publishes. Easy DKIM CNAMEs come from the
 * provider's tokens; SPF authorises the provider; DMARC may start at p=none.
 */
export function expectedEmailDomainRecords(domain: string, dkimTokens: readonly string[]): ExpectedDnsRecordDTO[] {
  return [
    { kind: 'SPF', type: 'TXT', name: domain, value: 'v=spf1 include:amazonses.com ~all', status: 'PENDING' },
    ...dkimTokens.map((token): ExpectedDnsRecordDTO => ({
      kind: 'DKIM',
      type: 'CNAME',
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      status: 'PENDING',
    })),
    {
      kind: 'DMARC',
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
      status: 'PENDING',
    },
  ];
}

const DMARC_POLICIES = new Set(['none', 'quarantine', 'reject']);

export interface DnsAnswers {
  /** TXT strings at the domain (each record's chunks joined). */
  domainTxt: readonly string[];
  /** TXT strings at _dmarc.<domain>. */
  dmarcTxt: readonly string[];
  /** CNAME targets per DKIM token. */
  dkimCnames: Readonly<Record<string, readonly string[]>>;
}

export interface DnsEvaluation {
  spfStatus: DnsRecordStatus;
  dkimStatus: DnsRecordStatus;
  dmarcStatus: DnsRecordStatus;
  dmarcPolicy: string | null;
  records: ExpectedDnsRecordDTO[];
  verified: boolean;
}

const stripDot = (v: string) => v.replace(/\.$/, '').toLowerCase();

/** Judges the published records against what sending needs; the domain is verified when all three hold. */
export function evaluateEmailDomainDns(
  domain: string,
  dkimTokens: readonly string[],
  answers: DnsAnswers,
): DnsEvaluation {
  const spf = answers.domainTxt.filter((t) => /^v=spf1\b/i.test(t.trim()));
  const spfStatus: DnsRecordStatus =
    spf.length === 0 ? 'MISSING' : spf.some((t) => /\binclude:amazonses\.com\b/i.test(t)) ? 'VALID' : 'INVALID';

  const dkimStatuses = dkimTokens.map((token): DnsRecordStatus => {
    const targets = (answers.dkimCnames[token] ?? []).map(stripDot);
    if (targets.length === 0) return 'MISSING';
    return targets.includes(`${token}.dkim.amazonses.com`) ? 'VALID' : 'INVALID';
  });
  const dkimStatus: DnsRecordStatus =
    dkimStatuses.length === 0 || dkimStatuses.every((s) => s === 'MISSING')
      ? 'MISSING'
      : dkimStatuses.every((s) => s === 'VALID')
        ? 'VALID'
        : 'INVALID';

  const dmarc = answers.dmarcTxt.filter((t) => /^v=DMARC1\b/i.test(t.trim()));
  let dmarcPolicy: string | null = null;
  let dmarcStatus: DnsRecordStatus = 'MISSING';
  if (dmarc.length > 0) {
    const match = /(?:^|;)\s*p\s*=\s*([a-z]+)/i.exec(dmarc[0]);
    dmarcPolicy = match ? match[1].toLowerCase() : null;
    dmarcStatus = dmarcPolicy && DMARC_POLICIES.has(dmarcPolicy) ? 'VALID' : 'INVALID';
  }

  let dkimIndex = 0;
  const records = expectedEmailDomainRecords(domain, dkimTokens).map((record) => ({
    ...record,
    status: record.kind === 'SPF' ? spfStatus : record.kind === 'DMARC' ? dmarcStatus : dkimStatuses[dkimIndex++],
  }));
  return {
    spfStatus,
    dkimStatus,
    dmarcStatus,
    dmarcPolicy,
    records,
    verified: spfStatus === 'VALID' && dkimStatus === 'VALID' && dmarcStatus === 'VALID',
  };
}

// -- Suppression -----------------------------------------------------------------------

/**
 * BOUNCE: the address does not exist (permanent bounce); silences it for
 * every sender. COMPLAINT: the recipient marked a message as spam; silences
 * it for that sender. UNSUBSCRIBE: recorded by the sender (or the link).
 */
export const EMAIL_SUPPRESSION_REASONS = ['BOUNCE', 'COMPLAINT', 'UNSUBSCRIBE'] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export interface EmailSuppressionDTO {
  id: string;
  email: string;
  reason: EmailSuppressionReason;
  /** True for a bounce recorded by the platform for every sender; only the platform owner can lift it. */
  global: boolean;
  createdAt: string;
}

export const AddEmailSuppressionSchema = z.object({ email: EmailAddressSchema }).strict();
export type AddEmailSuppressionInput = z.infer<typeof AddEmailSuppressionSchema>;

export const SendTestEmailSchema = z.object({ to: EmailAddressSchema }).strict();
export type SendTestEmailInput = z.infer<typeof SendTestEmailSchema>;

export interface EmailSettingsDTO {
  enabled: boolean;
  /** The provider can actually send (not the MOCK stand-in in production). */
  providerReady: boolean;
  platformFromAddress: string | null;
  domains: EmailDomainDTO[];
  suppressions: EmailSuppressionDTO[];
}

export type EmailKind = 'TRANSACTIONAL' | 'COMMERCIAL';

export const EMAIL_TEMPLATE_KEYS = ['test', 'campaign'] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/** Turns plain text into safe HTML paragraphs: translations are never HTML (rule 15). */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
