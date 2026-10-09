import { safeLocalPath } from './safe-path';

describe('safeLocalPath', () => {
  it('keeps a path on this site with its query and fragment', () => {
    expect(safeLocalPath('/panel/kebapci', '/x')).toBe('/panel/kebapci');
    expect(safeLocalPath('/m/abc?kayit=1#menu', '/x')).toBe('/m/abc?kayit=1#menu');
  });

  it('falls back for anything a browser could read as another origin', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'panel',
      '',
      undefined,
      null,
      42,
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(safeLocalPath(value, '/giris')).toBe('/giris');
    }
  });
});
