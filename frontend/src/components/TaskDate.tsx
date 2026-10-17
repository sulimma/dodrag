import React, { useEffect, useRef } from 'react';
import { TaskState } from '../domain/types';
import { formatIso8601Display, toDateKey } from '../domain/projector';
import { InlineEditor } from './inlineEditor';

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
          aria-label={`Startdatum ${task.id}`}
          type="text"
          value={editor.value}
          placeholder="JJJJ-MM-TT"
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
          aria-label={`Startdatum ${task.id} bearbeiten`}
          onClick={() => editor.onStart(task)}
          title={`Konfiguriertes Startdatum: ${display.isoText} (${display.weekdayShort}). Klicken zum Bearbeiten (JJJJ-MM-TT, optional Uhrzeit)`}
          className={`${compact ? 'px-1 text-[10px]' : 'px-2'} py-0.5 rounded border transition-colors hover:border-sky-400 hover:bg-sky-50/60 ${display.isWeekend ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100/90 text-slate-600 border-slate-200'}`}
        >
          {compact ? (
            toDateKey(new Date(task.configuredStart))
          ) : (
            <>
              {display.isoText}{' '}
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
