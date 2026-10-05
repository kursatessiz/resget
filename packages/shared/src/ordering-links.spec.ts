import { ORDER_SOURCES, orderSourceFromParam, orderingLink } from './ordering-links';

/** The query of a link as pairs, without relying on a URL global. */
const paramsOf = (link: string): Record<string, string> =>
  Object.fromEntries(
    (link.split('?')[1] ?? '')
      .split('&')
      .map((pair) => pair.split('='))
      .map(([key, value]) => [key, decodeURIComponent(value ?? '')]),
  );

describe('ordering links', () => {
  it('reads the channel from the link parameter and ignores anything else', () => {
    expect(orderSourceFromParam('instagram')).toBe('INSTAGRAM');
    expect(orderSourceFromParam(' WhatsApp ')).toBe('WHATSAPP');
    expect(orderSourceFromParam('myspace')).toBeNull();
    expect(orderSourceFromParam('')).toBeNull();
    expect(orderSourceFromParam(null)).toBeNull();
  });

  it('builds a link per channel that reads back to the same channel', () => {
    for (const source of ORDER_SOURCES) {
      const link = orderingLink('https://resget.example/kebapci', source);
      expect(link.startsWith('https://resget.example/kebapci?')).toBe(true);
      const params = paramsOf(link);
      expect(orderSourceFromParam(params.via)).toBe(source);
      expect(params.utm_source).toBe(source.toLowerCase());
      expect(params.utm_campaign).toBe('ordering_link');
    }
    expect(paramsOf(orderingLink('https://siparis.kebapci.example/', 'WHATSAPP')).utm_medium).toBe('messaging');
  });
});
