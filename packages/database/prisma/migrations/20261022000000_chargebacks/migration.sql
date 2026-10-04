-- Chargebacks (docs/MUTABAKAT.md, "Iade ve chargeback"). Additive only.
ALTER TYPE "PaymentStatus" ADD VALUE 'CHARGED_BACK';
ALTER TYPE "LedgerEntryType" ADD VALUE 'CHARGEBACK' BEFORE 'ADJUSTMENT';
