import {
  ACCOUNTING_ORDER_COLUMNS,
  AccountingPeriodSchema,
  accountingCell,
  accountingCsv,
  accountingFileName,
  bpsPercentText,
  localDateTimeText,
} from './accounting';

describe('accounting export', () => {
  it('reads the period from query strings', () => {
    expect(AccountingPeriodSchema.parse({ year: '2026', month: '10' })).toEqual({ year: 2026, month: 10 });
    expect(AccountingPeriodSchema.safeParse({ year: '2026', month: '13' }).success).toBe(false);
  });

  it('keeps amounts as numbers and neutralises formulas in text', () => {
    expect(accountingCell('-12.50')).toBe('-12.50');
    expect(accountingCell(0)).toBe('0');
    expect(accountingCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(accountingCell('-pide')).toBe("'-pide");
    expect(accountingCell('Lahmacun, acili')).toBe('"Lahmacun, acili"');
    expect(accountingCell('6" pide')).toBe('"6"" pide"');
    expect(accountingCell(null)).toBe('');
  });

  it('writes percents, local times and file names without a locale', () => {
    expect(bpsPercentText(1000)).toBe('10.00');
    expect(bpsPercentText(125)).toBe('1.25');
    expect(localDateTimeText(new Date('2026-10-01T21:30:00Z'), 'Europe/Istanbul')).toBe('2026-10-02 00:30');
    expect(localDateTimeText(new Date('2026-10-01T21:30:00Z'), 'UTC')).toBe('2026-10-01 21:30');
    expect(accountingFileName('orders', { year: 2026, month: 3 })).toBe('resget-orders-2026-03.csv');
  });

  it('builds a file with a BOM, a header and CRLF lines', () => {
    const csv = accountingCsv(['a', 'b'], [[1, 'x']]);
    expect(csv).toBe('﻿a,b\r\n1,x\r\n');
    expect(ACCOUNTING_ORDER_COLUMNS).toContain('chargedToCustomer');
  });
});
