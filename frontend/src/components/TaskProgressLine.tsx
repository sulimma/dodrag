import React from 'react';
import type { TaskState } from '../domain/types';
import { progressRatio } from '../domain/duration';
import { t } from '../i18n';

// Absolute positioning consumes existing padding, never increasing row height.
export function TaskProgressLine({ task, deemphasized = task.isDeemphasized }: { task: TaskState; deemphasized?: boolean }) {
  const ratio = progressRatio(task);
  if (task.completed || ratio === null) return null;
  return <div role="progressbar" aria-label={t('Fortschritt / Dauer')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio * 100}
    style={{ opacity: deemphasized ? 0.35 : 1 }}
    className="pointer-events-none absolute left-3 right-3 bottom-[3px] h-[2px] overflow-hidden bg-[#c8bcbc]">
    <div className="h-full bg-green-500" style={{ width: `${ratio * 100}%` }} />
  </div>;
}
