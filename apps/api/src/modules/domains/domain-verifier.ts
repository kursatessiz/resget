import { createHmac } from 'node:crypto';
import { promises as dns } from 'node:dns';

export const DOMAIN_VERIFIER = Symbol('DOMAIN_VERIFIER');

/** The TXT name a restaurant publishes under its host to prove the host is its own. */
export const DOMAIN_CHALLENGE_PREFIX = '_resget-verify';

/**
 * The owner proof for one restaurant and one host: derived, not stored, so it needs no column and changes when
 * either changes. Another restaurant claiming the same host gets a different value it cannot publish.
 */
export function domainChallenge(secret: string, restaurantId: string, host: string): { name: string; value: string } {
  const digest = createHmac('sha256', secret).update(`custom-domain:${restaurantId}:${host}`).digest('hex');
  return { name: `${DOMAIN_CHALLENGE_PREFIX}.${host}`, value: `resget-verify=${digest.slice(0, 32)}` };
}

/** Answers "where does this host point?" so a custom domain is served only once it reaches the platform. */
export interface DomainVerifierAdapter {
  readonly code: 'DNS' | 'MOCK';
  /** CNAME targets of the host, or its A records when there is no CNAME; empty when nothing resolves. */
  lookup(host: string): Promise<string[]>;
  /** A records of the platform host, so a domain pointing by A record instead of CNAME still verifies. */
  addressesOf(host: string): Promise<string[]>;
  /** TXT values of a name, each record's chunks joined; empty when there are none. */
  txt(name: string): Promise<string[]>;
}

export class DnsDomainVerifier implements DomainVerifierAdapter {
  readonly code = 'DNS' as const;

  async lookup(host: string): Promise<string[]> {
    const cnames = await dns.resolveCname(host).catch(() => [] as string[]);
    if (cnames.length > 0) return cnames.map((c) => c.toLowerCase().replace(/\.$/, ''));
    return this.addressesOf(host);
  }

  async addressesOf(host: string): Promise<string[]> {
    return dns.resolve4(host).catch(() => [] as string[]);
  }

  async txt(name: string): Promise<string[]> {
    const records = await dns.resolveTxt(name).catch(() => [] as string[][]);
    return records.map((chunks) => chunks.join(''));
  }
}

/**
 * Test stand-in: every host under .verified.test points at the platform, everything else at nothing. Its owner
 * proof is published unless the host starts with `notxt.`; a test may also publish a TXT value of its own.
 */
export class MockDomainVerifier implements DomainVerifierAdapter {
  readonly code = 'MOCK' as const;
  private readonly published = new Map<string, string>();

  constructor(
    private readonly target: string,
    private readonly expected: (host: string) => Promise<string | null> = async () => null,
  ) {}

  publish(name: string, value: string): void {
    this.published.set(name, value);
  }

  async txt(name: string): Promise<string[]> {
    const own = this.published.get(name);
    if (own) return [own];
    const host = name.split('.').slice(1).join('.');
    if (!host.endsWith('.verified.test') || host.startsWith('notxt.')) return [];
    const value = await this.expected(host);
    return value ? [value] : [];
  }

  async lookup(host: string): Promise<string[]> {
    return host.endsWith('.verified.test') ? [this.target] : [];
  }

  async addressesOf(): Promise<string[]> {
    return [];
  }
}
