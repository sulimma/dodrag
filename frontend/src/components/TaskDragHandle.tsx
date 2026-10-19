import React from 'react';
import { GripVertical } from 'lucide-react';
import { t } from '../i18n';
// An explicit, non-text drag origin avoids Chromium's Shift+text-selection gesture.
export function TaskDragHandle() {
  return <span draggable data-drag-handle title={t('Aufgabe ziehen (Shift: passende Kanten loesen)')} className="inline-flex shrink-0 cursor-grab select-none"><GripVertical className="w-3.5 h-3.5 text-slate-400 pointer-events-none" /></span>;
}
