'use client';

import { useMemo, useState } from 'react';
import {
  TAB_SPLIT_MAX_PEOPLE,
  TAB_SPLIT_MIN_PEOPLE,
  TAB_SPLIT_MODES,
  formatMoney,
  splitByAmount,
  splitByItems,
  splitEqual,
} from '@resget/shared';
import type { TabBillDTO, TabSplitMode } from '@resget/shared';
import { Button, TextField } from '@/components/ui';
import { useT } from '@/lib/use-t';

/**
 * Splits the bill three ways (docs/ACIK_HESAP.md): equally, by items (a
 * shared item split between the people who had it) or by amount. Only a
 * calculator: the table sees who pays what, the panel collects each share.
 * Equal and amount splits work on what is left; the item split covers the
 * whole bill with its discount.
 */
export function TabSplit({
  bill,
  locale,
  onUseShare,
}: {
  bill: TabBillDTO;
  locale: string;
  onUseShare?: (amountMinor: number) => void;
}) {
  const t = useT(locale);
  const [mode, setMode] = useState<TabSplitMode>('EQUAL');
  const [people, setPeople] = useState(TAB_SPLIT_MIN_PEOPLE);
  const [assignment, setAssignment] = useState<Record<string, number[]>>({});
  const [amounts, setAmounts] = useState<string[]>(() => Array.from({ length: TAB_SPLIT_MIN_PEOPLE }, () => ''));
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency: bill.currency }, locale);

  const setCount = (value: number) => {
    const n = Math.min(TAB_SPLIT_MAX_PEOPLE, Math.max(TAB_SPLIT_MIN_PEOPLE, Math.floor(value) || TAB_SPLIT_MIN_PEOPLE));
    setPeople(n);
    setAmounts((current) => Array.from({ length: n }, (_, i) => current[i] ?? ''));
    setAssignment((current) =>
      Object.fromEntries(Object.entries(current).map(([line, takers]) => [line, takers.filter((p) => p < n)])),
    );
  };

  const equal = useMemo(() => splitEqual(bill.dueMinor, people), [bill.dueMinor, people]);
  const items = useMemo(
    () =>
      splitByItems(
        bill.lines.map((l) => ({ id: l.id, totalMinor: l.totalMinor })),
        people,
        assignment,
        bill.discountMinor,
      ),
    [bill.lines, bill.discountMinor, people, assignment],
  );
  const typed = amounts.map((a) => (/^\d+$/.test(a.trim()) ? Number(a.trim()) : 0));
  const byAmount = splitByAmount(bill.dueMinor, typed);

  const shares = mode === 'EQUAL' ? equal : mode === 'ITEMS' ? items.shares : typed;

  const toggle = (lineId: string, person: number, on: boolean) =>
    setAssignment((current) => {
      const takers = current[lineId] ?? [];
      return { ...current, [lineId]: on ? [...takers, person] : takers.filter((p) => p !== person) };
    });

  return (
    <section className="flex flex-col gap-3" aria-label={t('tab.split.title')} data-tab-split>
      <h2 className="ui-heading">{t('tab.split.title')}</h2>
      <fieldset className="flex flex-wrap gap-4" aria-label={t('tab.split.title')}>
        {TAB_SPLIT_MODES.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input
              type="radio"
              className="pui-radio"
              name="tab-split-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span>{t(`tab.split.mode.${m}`)}</span>
          </label>
        ))}
      </fieldset>
      <TextField
        id="tab-split-people"
        type="number"
        label={t('tab.split.people')}
        min={TAB_SPLIT_MIN_PEOPLE}
        max={TAB_SPLIT_MAX_PEOPLE}
        value={String(people)}
        onChange={(e) => setCount(Number(e.target.value))}
      />

      {mode === 'EQUAL' && <p className="ui-caption">{t('tab.split.basis', { amount: money(bill.dueMinor) })}</p>}

      {mode === 'ITEMS' && (
        <>
          <p className="ui-caption">{t('tab.split.itemsHint')}</p>
          <div className="overflow-x-auto">
            <table className="pui-table w-full">
              <thead>
                <tr>
                  <th scope="col">{t('tab.bill.lines')}</th>
                  {Array.from({ length: people }, (_, i) => (
                    <th key={i} scope="col">
                      {t('tab.split.person', { n: i + 1 })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((line) => (
                  <tr key={line.id} data-split-line={line.id}>
                    <th scope="row">
                      {line.quantity} x {line.name} <span className="ui-caption">{money(line.totalMinor)}</span>
                    </th>
                    {Array.from({ length: people }, (_, i) => (
                      <td key={i}>
                        <input
                          type="checkbox"
                          className="pui-checkbox"
                          aria-label={`${line.name}: ${t('tab.split.person', { n: i + 1 })}`}
                          checked={(assignment[line.id] ?? []).includes(i)}
                          onChange={(e) => toggle(line.id, i, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.unassignedMinor > 0 && (
            <p className="ui-caption" data-split-unassigned>
              {t('tab.split.unassigned', { amount: money(items.unassignedMinor) })}
            </p>
          )}
        </>
      )}

      {mode === 'AMOUNT' && (
        <>
          <p className="ui-caption">{t('tab.split.amountHint')}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {amounts.map((value, i) => (
              <TextField
                key={i}
                id={`tab-split-amount-${i}`}
                type="number"
                min={0}
                label={t('tab.split.amountLabel', { n: i + 1 })}
                value={value}
                onChange={(e) => setAmounts((current) => current.map((a, j) => (j === i ? e.target.value : a)))}
              />
            ))}
          </div>
          {byAmount.ok ? (
            <p className="ui-caption" data-split-remaining>
              {t('tab.split.remaining', { amount: money(byAmount.remainingMinor) })}
            </p>
          ) : (
            <p role="alert" className="ui-text-muted">
              {t('tab.split.over', { amount: money(bill.dueMinor) })}
            </p>
          )}
        </>
      )}

      <ul className="ui-divide">
        {shares.map((amount, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2" data-split-share={i + 1}>
            <span>{t('tab.split.share', { n: i + 1, amount: money(amount) })}</span>
            {onUseShare && amount > 0 && amount <= bill.dueMinor && (mode !== 'AMOUNT' || byAmount.ok) && (
              <Button variant="outline" tone="muted" onClick={() => onUseShare(amount)}>
                {t('tab.split.useShare')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
