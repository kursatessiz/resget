import type { WhatsAppTemplateMessage } from '@resget/shared';
import type { SmsSendResult } from '../sms.provider';
import type { WhatsAppProvider } from '../whatsapp.provider';
import { callProvider, digitsOf } from './http';

export interface MetaWhatsAppOptions {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface MetaMessagesResponse {
  messages?: { id?: string }[];
  error?: { code?: number; message?: string };
}

/**
 * WhatsApp Business Cloud API (docs/MESAJLASMA.md, "Sağlayıcılar" and
 * "WhatsApp şablonları"). A message with a template goes out as a template
 * message (body variables in order), which Meta delivers outside the
 * 24-hour service window once the template is approved in the account;
 * a message without one goes out as text, which only works inside the
 * window. A refused send falls back to SMS when the restaurant allows it.
 * Meta has no credit balance; the console shows it as unknown.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly code = 'META';
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MetaWhatsAppOptions) {
    const version = options.graphVersion ?? 'v21.0';
    this.base = `${(options.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '')}/${version}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(toE164: string, text: string, template?: WhatsAppTemplateMessage): Promise<SmsSendResult> {
    const content = template
      ? {
          type: 'template',
          template: {
            name: template.name,
            language: { code: template.language },
            components:
              template.params.length > 0
                ? [{ type: 'body', parameters: template.params.map((value) => ({ type: 'text', text: value })) }]
                : [],
          },
        }
      : { type: 'text', text: { preview_url: false, body: text } };
    const answer = await callProvider<MetaMessagesResponse>(this.fetchImpl, {
      url: `${this.base}/${encodeURIComponent(this.options.phoneNumberId)}/messages`,
      headers: { authorization: `Bearer ${this.options.accessToken}` },
      json: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digitsOf(toE164),
        ...content,
      },
    });
    const id = answer.body?.messages?.[0]?.id;
    if (!answer.ok || !id) return { accepted: false, providerRef: null };
    return { accepted: true, providerRef: id };
  }
}
