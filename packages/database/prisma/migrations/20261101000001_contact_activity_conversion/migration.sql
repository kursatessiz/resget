-- Activities written by the attribution module (docs/ATIF.md): a site form and a recorded conversion.
ALTER TYPE "ContactActivityType" ADD VALUE IF NOT EXISTS 'FORM';
ALTER TYPE "ContactActivityType" ADD VALUE IF NOT EXISTS 'CONVERSION';
