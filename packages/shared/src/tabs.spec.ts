import { allocateTabPayment, countsOnBill, splitByAmount, splitByItems, splitEqual } from './tabs';

describe('open tab', () => {
  it('splits equally and gives the remainder to the first shares', () => {
    expect(splitEqual(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEqual(900, 3)).toEqual([300, 300, 300]);
    expect(splitEqual(1, 2)).toEqual([1, 0]);
    expect(() => splitEqual(100, 0)).toThrow(RangeError);
    expect(() => splitEqual(-1, 2)).toThrow(RangeError);
  });

  it('splits by items, a shared line equally between its takers', () => {
    const lines = [
      { id: 'a', totalMinor: 12000 },
      { id: 'b', totalMinor: 9001 },
      { id: 'c', totalMinor: 3000 },
    ];
    const split = splitByItems(lines, 3, { a: [0], b: [1, 2], c: [] });
    expect(split.shares).toEqual([12000, 4501, 4500]);
    expect(split.unassignedLineIds).toEqual(['c']);
    expect(split.unassignedMinor).toBe(3000);
    // Out of range people are ignored.
    expect(splitByItems(lines, 2, { a: [5] }).unassignedLineIds).toEqual(['a', 'b', 'c']);
  });

  it('spreads a discount over the shares so everything adds up to the bill', () => {
    const lines = [
      { id: 'a', totalMinor: 10000 },
      { id: 'b', totalMinor: 5000 },
      { id: 'c', totalMinor: 5000 },
    ];
    const half = splitByItems(lines, 2, { a: [0], b: [1] }, 1000);
    expect(half.shares).toEqual([9500, 4750]);
    expect(half.unassignedMinor).toBe(4750);
    const all = splitByItems(lines, 3, { a: [0], b: [1], c: [2] }, 1001);
    expect(all.shares.reduce((s, x) => s + x, 0)).toBe(20000 - 1001);
    expect(all.unassignedMinor).toBe(0);
  });

  it('checks a split by amount against what is due', () => {
    expect(splitByAmount(10000, [4000, 6000])).toEqual({ ok: true, remainingMinor: 0 });
    expect(splitByAmount(10000, [4000])).toEqual({ ok: true, remainingMinor: 6000 });
    expect(splitByAmount(10000, [8000, 3000])).toEqual({ ok: false, remainingMinor: -1000 });
  });

  it('allocates a collected share to the oldest orders first', () => {
    const orders = [
      { orderId: 'o1', dueMinor: 3000 },
      { orderId: 'o2', dueMinor: 0 },
      { orderId: 'o3', dueMinor: 5000 },
    ];
    expect(allocateTabPayment(4000, orders)).toEqual([
      { orderId: 'o1', amountMinor: 3000 },
      { orderId: 'o3', amountMinor: 1000 },
    ]);
    expect(allocateTabPayment(8000, orders)).toHaveLength(2);
    expect(() => allocateTabPayment(8001, orders)).toThrow(RangeError);
  });

  it('leaves cancelled and refunded orders off the bill', () => {
    expect(countsOnBill('DELIVERED')).toBe(true);
    expect(countsOnBill('PLACED')).toBe(true);
    expect(countsOnBill('REJECTED')).toBe(false);
    expect(countsOnBill('REFUNDED')).toBe(false);
  });
});
