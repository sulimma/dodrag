import React, { useEffect, useRef } from 'react';
import type { TaskState } from '../domain/types';
import type { InlineEditor } from './inlineEditor';
// Renders a task title as text or its active inline editor.
export function TaskTitle({
  task,
  editor,
  className = '',
}: {
  task: TaskState;
  editor: InlineEditor;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const editing = editor.taskId === task.id;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  if (editing)
    return (
      <input
        ref={input}
        aria-label={`Titel ${task.id}`}
        value={editor.value}
        onChange={(event) => editor.onChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onBlur={editor.onCommit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            editor.onCommit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            editor.onCancel();
          }
        }}
        className={`min-w-0 w-full rounded border border-sky-400 bg-white px-1 text-slate-900 ${className}`}
      />
    );
  return (
    <span
      title={task.title}
      onDoubleClick={(event) => {
        event.stopPropagation();
        editor.onStart(task);
      }}
      className={className}
    >
      {task.title}
    </span>
  );
}
