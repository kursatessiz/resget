import type { FiscalInvoiceInput, FiscalInvoiceResult, InvoiceProviderAdapter } from '@resget/shared';

export const INVOICE_PROVIDER = Symbol('INVOICE_PROVIDER');

/**
 * Development and test stand-in for the fiscal document integrator (e-Arsiv
 * in Turkey). It numbers documents deterministically from the invoice id so
 * a re-run never produces a second number for the same invoice. A real
 * integrator (the contract decides which) implements the same interface and
 * is selected by INVOICE_PROVIDER.
 */
export class MockInvoiceProvider implements InvoiceProviderAdapter {
  readonly code = 'MOCK';

  async issue(input: FiscalInvoiceInput): Promise<FiscalInvoiceResult> {
    const year = input.periodEnd.getUTCFullYear();
    return { ref: `MOCK${year}${input.invoiceId.replace(/-/g, '').slice(0, 12).toUpperCase()}`, documentUrl: null };
  }

  async cancel(): Promise<void> {
    return;
  }
}

/**
 * The integrator in production before a contract exists: no fiscal number is invented. Invoices are still cut,
 * shown and collected; their fiscal document waits (fiscalRef stays empty) and the real adapter, selected by
 * INVOICE_PROVIDER, issues the backlog on its first daily run (docs/FATURALAMA.md).
 */
export class UnavailableInvoiceProvider implements InvoiceProviderAdapter {
  readonly code = 'NONE';

  async issue(): Promise<FiscalInvoiceResult> {
    throw new Error('No fiscal document integrator is connected yet');
  }

  async cancel(): Promise<void> {
    return;
  }
}
