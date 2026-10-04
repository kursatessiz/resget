import { promises as dns } from 'node:dns';

export const EMAIL_DNS = Symbol('EMAIL_DNS');

/** What the domain check reads from DNS; injected so tests run without a network. */
export interface EmailDnsLookup {
  resolveTxt(name: string): Promise<string[]>;
  resolveCname(name: string): Promise<string[]>;
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'ENONAME']);

export class NodeEmailDnsLookup implements EmailDnsLookup {
  async resolveTxt(name: string): Promise<string[]> {
    try {
      return (await dns.resolveTxt(name)).map((chunks) => chunks.join(''));
    } catch (error) {
      if (NOT_FOUND.has((error as { code?: string }).code ?? '')) return [];
      throw error;
    }
  }

  async resolveCname(name: string): Promise<string[]> {
    try {
      return await dns.resolveCname(name);
    } catch (error) {
      if (NOT_FOUND.has((error as { code?: string }).code ?? '')) return [];
      throw error;
    }
  }
}

/**
 * Test stand-in: a domain under .verified.test publishes every record the
 * provider asks for; anything else publishes nothing.
 */
export class MockEmailDnsLookup implements EmailDnsLookup {
  async resolveTxt(name: string): Promise<string[]> {
    if (!name.endsWith('.verified.test')) return [];
    if (name.startsWith('_dmarc.')) return ['v=DMARC1; p=none'];
    return ['v=spf1 include:amazonses.com ~all'];
  }

  async resolveCname(name: string): Promise<string[]> {
    const match = /^([a-z0-9]+)\._domainkey\.(.+)$/.exec(name);
    if (!match || !match[2].endsWith('.verified.test')) return [];
    return [`${match[1]}.dkim.amazonses.com`];
  }
}
