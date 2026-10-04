import {
  menuMatchKey,
  parseCsv,
  parseImportAvailable,
  parseImportPrice,
  parseImportVat,
  parseMenuCsv,
} from './menu-import';

describe('menu import', () => {
  it('reads quoted fields, doubled quotes and the delimiter a spreadsheet chose', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseCsv('﻿kategori;ad;fiyat\nTatli;Sutlac;95,00')).toEqual([
      ['kategori', 'ad', 'fiyat'],
      ['Tatli', 'Sutlac', '95,00'],
    ]);
  });

  it('parses prices with either decimal mark and thousands groups, never with float arithmetic', () => {
    expect(parseImportPrice('120', 'TRY')).toBe(12000);
    expect(parseImportPrice('120,5', 'TRY')).toBe(12050);
    expect(parseImportPrice('1.250,50', 'TRY')).toBe(125050);
    expect(parseImportPrice('1,250.50', 'USD')).toBe(125050);
    expect(parseImportPrice('0.1', 'TRY')).toBe(10);
    expect(parseImportPrice('12.345', 'TRY')).toBeNull();
    expect(parseImportPrice('-5', 'TRY')).toBeNull();
    expect(parseImportPrice('abc', 'TRY')).toBeNull();
    expect(parseImportPrice('500', 'JPY')).toBe(500);
  });

  it('parses VAT percentages and availability words', () => {
    expect(parseImportVat('%10')).toBe(1000);
    expect(parseImportVat('8,5')).toBe(850);
    expect(parseImportVat('120')).toBeNull();
    expect(parseImportAvailable('Evet')).toBe(true);
    expect(parseImportAvailable('HAYIR')).toBe(false);
    expect(parseImportAvailable('')).toBe(true);
    expect(parseImportAvailable('belki')).toBeNull();
    expect(menuMatchKey('  İçecekler ')).toBe(menuMatchKey('içecekler'));
  });

  it('accepts Turkish headings, defaults VAT by country and reports every bad line', () => {
    const csv = [
      'Kategori;Ürün adı;Açıklama;Fiyat;Satışta',
      'Ana yemekler;Köfte;Pilav ile;320;evet',
      'Ana yemekler;köfte;;330;evet',
      ';Ayran;;45;evet',
      'İçecekler;Kola;;on lira;evet',
      'İçecekler;Su;;10;bilmem',
    ].join('\n');
    const parsed = parseMenuCsv(csv, 'TRY', 'TR');
    expect(parsed.defaultVatRateBps).toBe(1000);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      line: 2,
      category: 'Ana yemekler',
      name: 'Köfte',
      description: 'Pilav ile',
      priceMinor: 32000,
      vatRateBps: undefined,
      isAvailable: true,
    });
    expect(parsed.issues.map((i) => `${i.line}:${i.code}`)).toEqual([
      '3:DUPLICATE_ITEM',
      '4:CATEGORY_REQUIRED',
      '5:PRICE_INVALID',
      '6:AVAILABLE_INVALID',
    ]);
  });

  it('requires the columns it cannot do without', () => {
    expect(parseMenuCsv('name,price\nAyran,45', 'TRY', 'TR').issues).toEqual([
      { line: 1, code: 'MISSING_COLUMN', column: 'category' },
    ]);
    expect(parseMenuCsv('category,name,price\nA,B,1', 'EUR', 'DE').issues).toEqual([
      { line: 1, code: 'MISSING_COLUMN', column: 'vat_rate' },
    ]);
    expect(parseMenuCsv('category,name,price', 'TRY', 'TR').issues[0].code).toBe('EMPTY_FILE');
  });
});
