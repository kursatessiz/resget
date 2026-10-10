import { QrScanOutcome } from './enums';
import { TableQrTokenSchema, computeQrFunnel, qrFunnelFromCounts, tableQrPath, tableQrUrl } from './table-qr';

describe('table QR', () => {
  it('builds the public menu URL', () => {
    expect(tableQrPath('abcdefghijklmnopqrstuv')).toBe('/m/abcdefghijklmnopqrstuv');
    expect(tableQrUrl('https://app.example.com/', 'abcdefghijklmnopqrstuv')).toBe(
      'https://app.example.com/m/abcdefghijklmnopqrstuv',
    );
    expect(TableQrTokenSchema.safeParse('too-short').success).toBe(false);
  });

  it('counts sessions through the funnel, with later stages implying earlier ones', () => {
    const funnel = computeQrFunnel([
      { sessionId: 'a', outcome: QrScanOutcome.VIEWED_MENU },
      { sessionId: 'a', outcome: QrScanOutcome.VIEWED_MENU },
      { sessionId: 'b', outcome: QrScanOutcome.VIEWED_MENU },
      { sessionId: 'b', outcome: QrScanOutcome.STARTED_ORDER },
      { sessionId: 'c', outcome: QrScanOutcome.PLACED_ORDER },
      { sessionId: 'c', outcome: QrScanOutcome.REGISTERED },
      { sessionId: 'd', outcome: QrScanOutcome.VIEWED_MENU },
      { sessionId: 'd', outcome: QrScanOutcome.REGISTERED },
    ]);
    expect(funnel).toEqual({
      sessions: 4,
      viewedMenu: 4,
      startedOrder: 2,
      placedOrder: 1,
      registered: 2,
      viewToOrderRate: 0.25,
      viewToRegisterRate: 0.5,
    });
  });

  it('builds the same funnel from aggregate session counts', () => {
    expect(qrFunnelFromCounts({ sessions: 4, startedOrder: 2, placedOrder: 1, registered: 2 })).toEqual({
      sessions: 4,
      viewedMenu: 4,
      startedOrder: 2,
      placedOrder: 1,
      registered: 2,
      viewToOrderRate: 0.25,
      viewToRegisterRate: 0.5,
    });
    expect(qrFunnelFromCounts({ sessions: 0, startedOrder: 0, placedOrder: 0, registered: 0 }).viewToOrderRate).toBe(0);
  });

  it('handles an empty day', () => {
    expect(computeQrFunnel([]).viewToOrderRate).toBe(0);
  });
});
