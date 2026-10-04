import { BUNDLED_MESSAGES, createTranslator } from './i18n';
import { MESSAGE_TEMPLATE_KEYS, SMS_ONLY_TEMPLATE_KEYS } from './messaging';
import {
  WHATSAPP_DETAILS_PARAM,
  WHATSAPP_PARAM_MAX_CHARS,
  WHATSAPP_TEMPLATES,
  whatsappLanguageFor,
  whatsappTemplateFor,
} from './whatsapp-templates';

const t = createTranslator({ locale: 'tr', messages: BUNDLED_MESSAGES.tr!, fallback: BUNDLED_MESSAGES.tr! });
const DETAIL_SOURCES = ['reason', 'refund', 'note'];

describe('WhatsApp templates', () => {
  it('maps every business-initiated message and leaves the SMS-only platform messages out', () => {
    const mapped = Object.keys(WHATSAPP_TEMPLATES);
    for (const key of SMS_ONLY_TEMPLATE_KEYS) expect(mapped).not.toContain(key);
    expect(MESSAGE_TEMPLATE_KEYS.filter((k) => !SMS_ONLY_TEMPLATE_KEYS.includes(k) && !mapped.includes(k))).toEqual([]);
    const names = Object.values(WHATSAPP_TEMPLATES).map((s) => s!.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_]{1,512}$/);
  });

  it('only reads params the message text actually has, in every language', () => {
    for (const [key, spec] of Object.entries(WHATSAPP_TEMPLATES)) {
      for (const locale of Object.keys(BUNDLED_MESSAGES)) {
        const text = (BUNDLED_MESSAGES[locale] as Record<string, string>)[`messaging.template.${key}`]!;
        for (const param of spec!.params) {
          if (param === WHATSAPP_DETAILS_PARAM) {
            expect(DETAIL_SOURCES.some((s) => text.includes(`{${s}}`))).toBe(true);
            expect(spec!.detailsFallbackKey).toBeDefined();
          } else {
            expect(text).toContain(`{${param}}`);
          }
        }
      }
    }
  });

  it('fills variables in order, joins the details and never sends an empty parameter', () => {
    const accepted = whatsappTemplateFor(
      'order.accepted',
      { restaurant: 'Kebapci', code: 'AB12', minutes: 20, url: 'https://x.test/t/abc' },
      'tr-TR',
      t,
    );
    expect(accepted).toEqual({
      name: 'resget_order_accepted',
      language: 'tr',
      params: ['Kebapci', 'AB12', '20', 'https://x.test/t/abc'],
    });

    const rejected = whatsappTemplateFor(
      'order.rejected',
      { restaurant: 'Kebapci', code: 'AB12', reason: ' Neden: Malzeme\nbitti', refund: ' Odemeniz iade edildi.' },
      'tr',
      t,
    );
    expect(rejected!.params[2]).toBe('Neden: Malzeme bitti Odemeniz iade edildi.');

    const bare = whatsappTemplateFor(
      'order.cancelled',
      { restaurant: 'Kebapci', code: 'AB12', reason: '', refund: '' },
      'tr',
      t,
    );
    expect(bare!.params[2]).toBe(t('messaging.whatsapp.details.order'));

    const long = whatsappTemplateFor('campaign.body', { restaurant: 'K', body: 'x'.repeat(5000), url: 'u' }, 'en', t);
    expect(long!.params[1]).toHaveLength(WHATSAPP_PARAM_MAX_CHARS);
    expect(long!.language).toBe('en');

    expect(whatsappTemplateFor('otp.code', { code: '123456' }, 'tr', t)).toBeNull();
  });

  it('uses the base language of the recipient locale', () => {
    expect(whatsappLanguageFor('en-GB')).toBe('en');
    expect(whatsappLanguageFor('de_AT')).toBe('de');
  });
});
