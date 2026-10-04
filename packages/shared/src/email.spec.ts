import {
  SenderDomainSchema,
  evaluateEmailDomainDns,
  expectedEmailDomainRecords,
  maskEmail,
  normalizeEmail,
  plainTextToHtml,
} from './email';

const tokens = ['abc123', 'def456', 'ghi789'];
const good = {
  domainTxt: ['google-site-verification=x', 'v=spf1 include:_spf.google.com include:amazonses.com ~all'],
  dmarcTxt: ['v=DMARC1; p=quarantine; rua=mailto:d@ornek.com'],
  dkimCnames: Object.fromEntries(tokens.map((t) => [t, [`${t}.dkim.amazonses.com.`]])),
};

describe('email addresses', () => {
  it('normalises and masks addresses', () => {
    expect(normalizeEmail('  Ayse@Ornek.COM ')).toBe('ayse@ornek.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(maskEmail('ayse@ornek.com')).toBe('a***@ornek.com');
  });

  it('accepts registrable domains only', () => {
    expect(SenderDomainSchema.safeParse('Ornek-Restoran.com.tr').success).toBe(true);
    expect(SenderDomainSchema.safeParse('localhost').success).toBe(false);
    expect(SenderDomainSchema.safeParse('https://ornek.com').success).toBe(false);
    expect(SenderDomainSchema.safeParse('-ornek.com').success).toBe(false);
  });
});

describe('sender domain DNS', () => {
  it('lists SPF, one CNAME per DKIM token and DMARC', () => {
    const records = expectedEmailDomainRecords('ornek.com', tokens);
    expect(records.map((r) => r.kind)).toEqual(['SPF', 'DKIM', 'DKIM', 'DKIM', 'DMARC']);
    expect(records[1]).toMatchObject({ name: 'abc123._domainkey.ornek.com', value: 'abc123.dkim.amazonses.com' });
  });

  it('verifies only when SPF, every DKIM CNAME and a DMARC policy are in place', () => {
    const result = evaluateEmailDomainDns('ornek.com', tokens, good);
    expect(result).toMatchObject({ spfStatus: 'VALID', dkimStatus: 'VALID', dmarcStatus: 'VALID', verified: true });
    expect(result.dmarcPolicy).toBe('quarantine');
    expect(result.records.every((r) => r.status === 'VALID')).toBe(true);
  });

  it('tells missing, wrong and partial records apart', () => {
    const none = evaluateEmailDomainDns('ornek.com', tokens, { domainTxt: [], dmarcTxt: [], dkimCnames: {} });
    expect(none).toMatchObject({
      spfStatus: 'MISSING',
      dkimStatus: 'MISSING',
      dmarcStatus: 'MISSING',
      verified: false,
    });
    const wrong = evaluateEmailDomainDns('ornek.com', tokens, {
      domainTxt: ['v=spf1 include:_spf.google.com ~all'],
      dmarcTxt: ['v=DMARC1; p=sometimes'],
      dkimCnames: { abc123: ['abc123.dkim.amazonses.com'], def456: ['elsewhere.example'] },
    });
    expect(wrong).toMatchObject({
      spfStatus: 'INVALID',
      dkimStatus: 'INVALID',
      dmarcStatus: 'INVALID',
      verified: false,
    });
    expect(wrong.records.filter((r) => r.kind === 'DKIM').map((r) => r.status)).toEqual([
      'VALID',
      'INVALID',
      'MISSING',
    ]);
  });
});

describe('plain text to HTML', () => {
  it('escapes everything and keeps paragraphs', () => {
    expect(plainTextToHtml('Merhaba <b>"Ali"</b> & ekip\n\nIkinci\nsatir')).toBe(
      '<p>Merhaba &lt;b&gt;&quot;Ali&quot;&lt;/b&gt; &amp; ekip</p>\n<p>Ikinci<br>satir</p>',
    );
  });
});
