import { BASE_MESSAGES, BUNDLED_MESSAGES, EN_NAMESPACES, TR_NAMESPACES } from './messages';
import { createTranslator, interpolate } from './translator';
import { parseAcceptLanguage, resolveLocale } from './locales';
import { MessageKeySchema, validatePackMessages } from './pack';

describe('bundled catalogues', () => {
  it('has no key defined in two namespaces', () => {
    const total = TR_NAMESPACES.reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(Object.keys(BASE_MESSAGES)).toHaveLength(total);
    const enTotal = EN_NAMESPACES.reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(Object.keys(BUNDLED_MESSAGES.en)).toHaveLength(enTotal);
  });

  it('keeps every namespace file prefixed by one namespace', () => {
    for (const ns of TR_NAMESPACES) {
      const prefixes = new Set(Object.keys(ns).map((k) => k.split('.')[0]));
      // The permissions file also names the default roles; every other file has one prefix.
      expect(prefixes.size).toBeLessThanOrEqual(prefixes.has('permissions') ? 2 : 1);
    }
  });

  it('uses valid keys only', () => {
    for (const key of Object.keys(BASE_MESSAGES)) {
      expect(MessageKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('translates every key into English with the same placeholders', () => {
    const en = BUNDLED_MESSAGES.en;
    expect(Object.keys(en).sort()).toEqual(Object.keys(BASE_MESSAGES).sort());
    const result = validatePackMessages({ ...en }, BASE_MESSAGES);
    expect(result.placeholderMismatches).toEqual([]);
    expect(result.emptyKeys).toEqual([]);
  });

  it('contains no emoji', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const catalogue of Object.values(BUNDLED_MESSAGES)) {
      for (const value of Object.values(catalogue)) expect(emoji.test(value)).toBe(false);
    }
  });
});

describe('translator', () => {
  const fallback = {
    'a.hello': 'Merhaba {name}',
    'a.only': 'Yalnız Türkçe',
    'a.n.one': '{count} öğe',
    'a.n.other': '{count} öğe',
  };
  const messages = { 'a.hello': 'Hello {name}', 'a.n.one': '{count} item', 'a.n.other': '{count} items' };

  it('interpolates named params and falls back to the base language, then the key', () => {
    expect(interpolate('Hi {name} {missing}', { name: 'Ada' })).toBe('Hi Ada {missing}');
    const t = createTranslator({ locale: 'en', messages, fallback });
    expect(t('a.hello', { name: 'Ada' })).toBe('Hello Ada');
    expect(t('a.only')).toBe('Yalnız Türkçe');
    expect(t('a.none')).toBe('a.none');
    expect(t('a.n', { count: 1200 })).toBe('1,200 items');
  });
});

describe('locale resolution', () => {
  it('prefers the first enabled candidate and orders Accept-Language by quality', () => {
    expect(resolveLocale(['tr', 'en'], [null, 'de', 'en-GB'])).toBe('en');
    expect(resolveLocale(['tr', 'en'], ['fr'])).toBe('tr');
    expect(parseAcceptLanguage('de;q=0.5, en-gb, tr;q=0.8, *;q=0.1')).toEqual(['en-GB', 'tr', 'de']);
  });
});
