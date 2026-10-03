import { promises as dns } from 'node:dns';

export const DOMAIN_VERIFIER = Symbol('DOMAIN_VERIFIER');

/** Answers "where does this host point?" so a custom domain is served only once it reaches the platform. */
export interface DomainVerifierAdapter {
  readonly code: 'DNS' | 'MOCK';
  /** CNAME targets of the host, or its A records when there is no CNAME; empty when nothing resolves. */
  lookup(host: string): Promise<string[]>;
  /** A records of the platform host, so a domain pointing by A record instead of CNAME still verifies. */
  addressesOf(host: string): Promise<string[]>;
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
}

/** Test stand-in: every host under .verified.test points at the platform, everything else at nothing. */
export class MockDomainVerifier implements DomainVerifierAdapter {
  readonly code = 'MOCK' as const;

  constructor(private readonly target: string) {}

  async lookup(host: string): Promise<string[]> {
    return host.endsWith('.verified.test') ? [this.target] : [];
  }

  async addressesOf(): Promise<string[]> {
    return [];
  }
}
