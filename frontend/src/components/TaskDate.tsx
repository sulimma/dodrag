import React, { useEffect, useRef } from 'react';
import type { TaskState } from '../domain/types';
import { formatIso8601Display } from '../domain/projector';
import type { InlineEditor } from './inlineEditor';
import { t, formatDate } from '../i18n';

// Renders a configured task date and its inline editor.
export function TaskDate({
  task,
  editor,
  compact = false,
}: {
  task: TaskState;
  editor: InlineEditor;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const editing = editor.taskId === task.id;
  const display = formatIso8601Display(task.configuredStart);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  return (
    <div
      className="flex items-center min-w-0 text-[11px] font-mono"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {editing ? (
        <input
          ref={input}
          aria-label={t('Startdatum {id}', { id: task.id })}
          type="text"
          value={editor.value}
          placeholder={t('JJJJ-MM-TT')}
          onChange={(event) => editor.onChange(event.target.value)}
          onBlur={editor.onCommit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              editor.onCommit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              editor.onCancel();
            }
          }}
          className={`${compact ? 'w-24 px-1' : 'w-28 px-2'} min-w-0 py-0.5 rounded border border-sky-500 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30`}
        />
      ) : (
        <button
          type="button"
          aria-label={t('Startdatum {id} bearbeiten', { id: task.id })}
          onClick={() => editor.onStart(task)}
          title={t('Konfiguriertes Startdatum: {date} ({weekday}). Klicken zum Bearbeiten (JJJJ-MM-TT, optional Uhrzeit)', { date: display.localizedText, weekday: display.weekdayShort })}
          className={`${compact ? 'px-1 text-[10px]' : 'px-2'} py-0.5 rounded border transition-colors hover:border-sky-400 hover:bg-sky-50/60 ${display.isWeekend ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100/90 text-slate-600 border-slate-200'}`}
        >
          {compact ? (
            formatDate(task.configuredStart)
          ) : (
            <>
              {display.localizedText}{' '}
              <span
                className={
                  display.isWeekend
                    ? 'text-amber-700 font-semibold'
                    : 'text-slate-400'
                }
              >
                ({display.weekdayShort})
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
