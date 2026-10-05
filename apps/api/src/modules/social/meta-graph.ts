import type { MetaLeadField, SocialAccountKind } from '@resget/shared';
import { META_OAUTH_SCOPES } from '@resget/shared';

/** An account the consent gave access to, with the token to act for it. */
export interface MetaAccount {
  kind: SocialAccountKind;
  externalId: string;
  name: string;
  /** Page access token; Instagram business accounts act through their page's token. */
  token: string;
}

/** A Lead Ads lead as the Graph API returns it to the page. */
export interface MetaLeadData {
  fields: MetaLeadField[];
  formId: string | null;
  adId: string | null;
}

export interface MetaUserToken {
  token: string;
  expiresAt: Date | null;
}

/** Meta's OAuth and Graph API as the integration hub uses them (docs/ENTEGRASYON_MERKEZI.md). */
export interface MetaGraph {
  readonly name: 'MOCK' | 'LIVE';
  authorizeUrl(state: string, redirectUri: string): string;
  /** Code to a long-lived user token. */
  exchangeCode(code: string, redirectUri: string): Promise<MetaUserToken>;
  /** The pages the user manages and the Instagram business accounts linked to them. */
  accounts(userToken: string): Promise<MetaAccount[]>;
  /** Subscribes the app to the page's leadgen webhook (docs/LEAD_ADS.md). */
  subscribeLeadgen(pageId: string, pageToken: string): Promise<void>;
  /** A lead's answers, read with the token of the page it came from. */
  lead(leadgenId: string, pageToken: string): Promise<MetaLeadData>;
}

/** Graph object ids are digits; anything else never reaches a request path. */
const GRAPH_ID = /^\d{1,32}$/;

function graphId(id: string): string {
  if (!GRAPH_ID.test(id)) throw new Error('invalid Graph id');
  return id;
}

export const META_GRAPH = Symbol('META_GRAPH');

const TIMEOUT_MS = 10_000;
/** Pages fetched at most per consent: 10 pages of 100. */
const MAX_PAGES = 10;

interface GraphPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

/** The live Graph API over fetch; no SDK, the surface is three calls. */
export class LiveMetaGraph implements MetaGraph {
  readonly name = 'LIVE' as const;
  private readonly graph: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly version: string,
  ) {
    this.graph = `https://graph.facebook.com/${version}`;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: META_OAUTH_SCOPES.join(','),
    });
    return `https://www.facebook.com/${this.version}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<MetaUserToken> {
    const short = await this.get<{ access_token: string }>('/oauth/access_token', {
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    // A short-lived token lasts an hour; the long-lived one about sixty days, and page tokens from it do not expire.
    const long = await this.get<{ access_token: string; expires_in?: number }>('/oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: short.access_token,
    });
    return {
      token: long.access_token,
      expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
    };
  }

  async accounts(userToken: string): Promise<MetaAccount[]> {
    const out: MetaAccount[] = [];
    let url: string | null = `${this.graph}/me/accounts?${new URLSearchParams({
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: '100',
      access_token: userToken,
    }).toString()}`;
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const body: { data?: GraphPage[]; paging?: { next?: string } } = await this.fetchJson(url);
      for (const row of body.data ?? []) {
        out.push({ kind: 'FACEBOOK_PAGE', externalId: row.id, name: row.name, token: row.access_token });
        const ig = row.instagram_business_account;
        if (ig) {
          out.push({
            kind: 'INSTAGRAM_BUSINESS',
            externalId: ig.id,
            name: ig.username ? `@${ig.username}` : row.name,
            token: row.access_token,
          });
        }
      }
      url = body.paging?.next ?? null;
    }
    return out;
  }

  async subscribeLeadgen(pageId: string, pageToken: string): Promise<void> {
    const body = await this.fetchJson<{ success?: boolean }>(`${this.graph}/${graphId(pageId)}/subscribed_apps`, {
      method: 'POST',
      body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: pageToken }),
    });
    if (body.success !== true) throw new Error('Meta Graph subscription refused');
  }

  async lead(leadgenId: string, pageToken: string): Promise<MetaLeadData> {
    const body = await this.get<{ field_data?: MetaLeadField[]; form_id?: string; ad_id?: string }>(
      `/${graphId(leadgenId)}`,
      { fields: 'field_data,form_id,ad_id', access_token: pageToken },
    );
    return {
      fields: (body.field_data ?? []).filter((f) => typeof f?.name === 'string' && Array.isArray(f.values)),
      formId: body.form_id ?? null,
      adId: body.ad_id ?? null,
    };
  }

  private get<T>(path: string, params: Record<string, string>): Promise<T> {
    return this.fetchJson<T>(`${this.graph}${path}?${new URLSearchParams(params).toString()}`);
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as (T & { error?: { code?: number } }) | null;
    if (!res.ok || !body) throw new Error(`Meta Graph ${res.status} ${body?.error?.code ?? ''}`.trim());
    return body;
  }
}

/** Consent round trip without Meta: the authorize address points straight back at the callback. */
export class MockMetaGraph implements MetaGraph {
  readonly name = 'MOCK' as const;

  authorizeUrl(state: string, redirectUri: string): string {
    return `${redirectUri}?${new URLSearchParams({ code: 'mock-code', state }).toString()}`;
  }

  async exchangeCode(code: string): Promise<MetaUserToken> {
    if (code !== 'mock-code') throw new Error('unknown mock code');
    return { token: 'mock-user-token', expiresAt: new Date(Date.now() + 60 * 86_400_000) };
  }

  async accounts(): Promise<MetaAccount[]> {
    return [
      { kind: 'FACEBOOK_PAGE', externalId: 'mock-page-1', name: 'Deneme Sayfasi', token: 'mock-page-token-1' },
      { kind: 'INSTAGRAM_BUSINESS', externalId: 'mock-ig-1', name: '@deneme', token: 'mock-page-token-1' },
    ];
  }

  async subscribeLeadgen(): Promise<void> {}

  /**
   * Leadgen ids 900000 to 900999 answer with a full form whose phone follows
   * the id; 910000 to 910999 with a form without a phone; anything else fails
   * like an unreachable Graph API.
   */
  async lead(leadgenId: string): Promise<MetaLeadData> {
    const id = Number(leadgenId);
    if (id >= 900_000 && id <= 900_999) {
      const n = String(id - 900_000).padStart(4, '0');
      return {
        fields: [
          { name: 'full_name', values: [`Aday ${n}`] },
          { name: 'phone_number', values: [`0555 000 ${n}`] },
          { name: 'email', values: [`aday${n}@example.com`] },
          { name: 'city', values: ['Istanbul'] },
          { name: 'kac_kisilik', values: ['4'] },
        ],
        formId: '700001',
        adId: '800001',
      };
    }
    if (id >= 910_000 && id <= 910_999) {
      return { fields: [{ name: 'full_name', values: ['Telefonsuz Aday'] }], formId: '700001', adId: null };
    }
    throw new Error('Meta Graph 500');
  }
}
