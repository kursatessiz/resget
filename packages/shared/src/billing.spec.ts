import { collectionIsDue, invoiceIsOverdue, previousCommissionPeriod } from './billing';

describe('billing rules', () => {
  it('invoices the UTC month before the run, across a year boundary', () => {
    expect(previousCommissionPeriod(new Date('2026-10-01T00:30:00Z'))).toEqual({ year: 2026, month: 9 });
    expect(previousCommissionPeriod(new Date('2026-01-15T12:00:00Z'))).toEqual({ year: 2025, month: 12 });
  });

  it('marks an issued invoice overdue only after its due moment', () => {
    const dueAt = new Date('2026-10-11T00:00:00Z');
    expect(invoiceIsOverdue({ status: 'ISSUED', dueAt }, new Date('2026-10-10T23:59:59Z'))).toBe(false);
    expect(invoiceIsOverdue({ status: 'ISSUED', dueAt }, new Date('2026-10-11T00:00:01Z'))).toBe(true);
    expect(invoiceIsOverdue({ status: 'PAID', dueAt }, new Date('2026-12-01T00:00:00Z'))).toBe(false);
    expect(invoiceIsOverdue({ status: 'ISSUED', dueAt: null }, new Date('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('retries a charge after the cool-down and stops at the attempt limit', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(collectionIsDue({ status: 'ISSUED', collectionAttempts: 0, lastCollectionAt: null }, now)).toBe(true);
    expect(
      collectionIsDue(
        { status: 'ISSUED', collectionAttempts: 1, lastCollectionAt: new Date('2026-10-05T00:00:00Z') },
        now,
      ),
    ).toBe(false);
    expect(
      collectionIsDue(
        { status: 'OVERDUE', collectionAttempts: 1, lastCollectionAt: new Date('2026-10-04T10:00:00Z') },
        now,
      ),
    ).toBe(true);
    expect(collectionIsDue({ status: 'ISSUED', collectionAttempts: 5, lastCollectionAt: null }, now)).toBe(false);
    expect(collectionIsDue({ status: 'PAID', collectionAttempts: 0, lastCollectionAt: null }, now)).toBe(false);
  });
});
