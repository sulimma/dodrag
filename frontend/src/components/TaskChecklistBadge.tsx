import React from 'react';
import { CheckSquare } from 'lucide-react';
import type { ChecklistProgress } from '../domain/types';
import { formatNumber, t, useLanguage } from '../i18n';

export function TaskChecklistBadge({
  progress,
  compact = false,
}: {
  progress: ChecklistProgress | null;
  compact?: boolean;
}) {
  useLanguage();
  if (!progress || progress.total === 0) return null;
  const checked = formatNumber(progress.checked);
  const total = formatNumber(progress.total);
  const label = t('Checkliste: {checked} von {total} erledigt', { checked, total });
  return (
    <span
      data-task-checklist-badge
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-0.5 shrink-0 whitespace-nowrap rounded border font-mono ${
        compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-[11px]'
      } ${progress.checked === progress.total
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-slate-50 border-slate-200 text-slate-500'}`}
    >
      <CheckSquare className="w-3 h-3" aria-hidden="true" />
      <span>{checked}/{total}</span>
    </span>
  );
}
