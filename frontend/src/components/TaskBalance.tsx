import React from 'react';
import type { TaskDayBalance } from '../domain/types';
import { formatNumber, t } from '../i18n';

// The same gross changes appear in the toolbar and protocol. A protocol divider
// precedes its day, so it starts with the opening balance; the toolbar ends with
// the current total. Filtering never changes these database-wide figures.
export function TaskBalance({ balance, count, opening = false }: {
  balance: TaskDayBalance; count?: number; opening?: boolean;
}) {
  const additions = `+${formatNumber(balance.added)}`, removals = `-${formatNumber(balance.removed)}`;
  const total = formatNumber(count ?? balance.end), start = formatNumber(balance.start);
  const expression = opening ? `${start} ${additions} ${removals}` : `${additions} ${removals} = ${total}`;
  return <span data-task-balance={opening ? 'opening' : 'current'}
    className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-normal tabular-nums text-slate-700"
    aria-label={`${t('Offene Tasks')}: ${expression}`} title={t('Offene Tasks')}>
    {opening && <><span>{start}</span>{' '}</>}
    <span className="text-red-600">{additions}</span>{' '}
    <span className="text-emerald-600">{removals}</span>
    {!opening && <>{' = '}<span>{total}</span></>}
  </span>;
}
