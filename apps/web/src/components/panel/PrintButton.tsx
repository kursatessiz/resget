'use client';

import { Button } from '@/components/ui';

/** Opens the browser's print dialog; saving as PDF happens there. */
export function PrintButton({ label }: { label: string }) {
  return <Button onClick={() => window.print()}>{label}</Button>;
}
