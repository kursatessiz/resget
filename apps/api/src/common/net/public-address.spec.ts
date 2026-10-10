import { isNonPublicAddress, nonPublicUrlReason } from './public-address';

describe('public address guard', () => {
  it('knows private, loopback, link-local and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1']) {
      expect(isNonPublicAddress(address)).toBe(true);
    }
    for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isNonPublicAddress(address)).toBe(true);
    }
    expect(isNonPublicAddress('93.184.216.34')).toBe(false);
    expect(isNonPublicAddress('2606:4700::1111')).toBe(false);
  });

  it('accepts only https URLs to public hosts', () => {
    expect(nonPublicUrlReason('https://hooks.example.com/resget')).toBeNull();
    expect(nonPublicUrlReason('https://93.184.216.34/hook')).toBeNull();
    for (const url of [
      'http://hooks.example.com',
      'https://localhost/hook',
      'https://postgres:5432',
      'https://api/health',
      'https://printer.local/x',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/hook',
      'https://[::1]/hook',
      // Credentials in the URL are refused; the value is built so it never reads as a real secret.
      `https://${'user'}:${'x'}@hooks.example.com`,
      'not a url',
    ]) {
      expect(nonPublicUrlReason(url)).not.toBeNull();
    }
  });
});
