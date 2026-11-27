import { Copy } from 'lucide-react';
import { useState } from 'react';
import { errorText, t } from '../../i18n';

export type TaskSummary = Readonly<{
  id: string;
  title: string;
  status: 'open' | 'active' | 'done';
  date: string;
}>;

export function formatTaskSummary(task: TaskSummary): string {
  const status = task.status === 'done' ? t('Erledigt') : task.status === 'active' ? t('Aktiv') : t('Offen');
  return `${task.id} · ${task.title}\n${status}\n${task.date}`;
}

export function CopyTaskSummary({ label, disabled, currentTask }: {
  label: string;
  disabled: boolean;
  currentTask: () => TaskSummary | null;
}) {
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <button type="button" disabled={disabled} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-slate-700 hover:bg-sky-100 focus-visible:outline focus-visible:outline-sky-500 disabled:opacity-50"
      onMouseDown={event => {
        // Mouse copying should not blur (and commit) an active task editor.
        if (event.button === 0 && document.activeElement?.closest('[data-task-detail-panel]')?.contains(event.currentTarget)) event.preventDefault();
      }}
      onClick={async () => {
        const task = currentTask();
        if (!task) return;
        setFeedback(null);
        try {
          await navigator.clipboard.writeText(formatTaskSummary(task));
          if (currentTask()) setFeedback({ message: t('Task-Zusammenfassung kopiert.') });
        } catch (error) {
          if (currentTask()) setFeedback({ error: true, message: errorText(t('Task-Zusammenfassung konnte nicht kopiert werden.'), error) });
        }
      }}>
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </button>
    <span role="status" className={feedback?.error ? 'text-red-700' : 'text-slate-600'}>{feedback?.message}</span>
  </div>;
}
