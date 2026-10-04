import {
  CLAIM_DECISION_HOURS,
  CLAIM_WINDOW_HOURS,
  FileClaimSchema,
  approvedClaimItems,
  canFileClaim,
  claimEscalationDue,
  isClaimWaiting,
} from './claims';

const now = new Date('2026-10-04T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const ITEM = '6f1c2a7e-3b7c-4d9e-9a51-6b0f4f7d2c11';

describe('missing-item claims', () => {
  it('opens for a completed order within the window when nothing waits and money is left', () => {
    const completed = { status: 'DELIVERED', completedAt: hoursAgo(2) };
    expect(canFileClaim(completed, false, 1000, now)).toBe(true);
    expect(canFileClaim({ status: 'PICKED_UP', completedAt: hoursAgo(CLAIM_WINDOW_HOURS) }, false, 1, now)).toBe(true);
    expect(canFileClaim({ status: 'DELIVERED', completedAt: hoursAgo(CLAIM_WINDOW_HOURS + 1) }, false, 1, now)).toBe(
      false,
    );
    expect(canFileClaim(completed, true, 1000, now)).toBe(false);
    expect(canFileClaim(completed, false, 0, now)).toBe(false);
    expect(canFileClaim({ status: 'REFUNDED', completedAt: hoursAgo(1) }, false, 1000, now)).toBe(false);
    expect(canFileClaim({ status: 'PREPARING', completedAt: null }, false, 1000, now)).toBe(false);
  });

  it('approves what was claimed or less, never more or other items', () => {
    const claimed = [{ orderItemId: 'a', quantity: 2 }];
    expect(approvedClaimItems(claimed, undefined)).toEqual(claimed);
    expect(approvedClaimItems(claimed, [{ orderItemId: 'a', quantity: 1 }])).toEqual([
      { orderItemId: 'a', quantity: 1 },
    ]);
    expect(approvedClaimItems(claimed, [{ orderItemId: 'a', quantity: 3 }])).toBeNull();
    expect(approvedClaimItems(claimed, [{ orderItemId: 'b', quantity: 1 }])).toBeNull();
  });

  it('needs at least one item, each once, and keeps the note short', () => {
    expect(FileClaimSchema.safeParse({ items: [{ orderItemId: ITEM, quantity: 1 }] }).success).toBe(true);
    expect(FileClaimSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      FileClaimSchema.safeParse({
        items: [
          { orderItemId: ITEM, quantity: 1 },
          { orderItemId: ITEM, quantity: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      FileClaimSchema.safeParse({ items: [{ orderItemId: ITEM, quantity: 1 }], note: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('treats escalated claims as waiting and escalates after the decision window', () => {
    expect(isClaimWaiting('OPEN')).toBe(true);
    expect(isClaimWaiting('ESCALATED')).toBe(true);
    expect(isClaimWaiting('APPROVED')).toBe(false);
    expect(isClaimWaiting('DECLINED')).toBe(false);
    expect(claimEscalationDue(hoursAgo(CLAIM_DECISION_HOURS - 1), now)).toBe(false);
    expect(claimEscalationDue(hoursAgo(CLAIM_DECISION_HOURS), now)).toBe(true);
  });
});
