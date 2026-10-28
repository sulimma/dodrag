import React, { useEffect, useRef } from 'react';
import type { TaskState } from '../domain/types';
import { inlineTextHandlers, type InlineEditor } from './inlineEditor';
import { t } from '../i18n';
// Keep the same native text surface for reading, selection and inline editing.
export function TaskTitle({
  task,
  editor,
  className = '',
}: {
  task: TaskState;
  editor: InlineEditor;
  className?: string;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const editing = editor.taskId === task.id;
  useEffect(() => {
    const node = text.current;
    if (!node) return;
    const value = editing ? editor.value : task.title;
    if (node.textContent !== value) node.textContent = value;
    if (!editing && document.activeElement === node) node.blur();
    // Mouse focus keeps the native caret/selection; keyboard entry selects the title.
    if (editing && document.activeElement !== node) {
      node.focus();
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [editing, editor.value, task.title]);
  return (
    <span
      ref={text}
      data-task-title
      data-task-title-editing={editing ? 'true' : undefined}
      data-task-selectable-text
      contentEditable={!task.completed}
      suppressContentEditableWarning
      role={task.completed ? undefined : 'textbox'}
      aria-label={t('Titel {id}', { id: task.id })}
      aria-multiline={task.completed ? undefined : false}
      title={task.title}
      onFocus={() => { if (!editing && !task.completed) editor.onStart(task); }}
      onClick={(event) => {
        event.stopPropagation();
        if (!editing && !task.completed) editor.onStart(task);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onInput={(event) => {
        if (!editing) editor.onStart(task);
        editor.onChange(event.currentTarget.textContent ?? '');
      }}
      onPaste={(event) => {
        event.preventDefault();
        // Native plain-text insertion preserves caret and undo; never insert clipboard HTML.
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' '));
      }}
      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
      {...(editing ? inlineTextHandlers(editor.onCommit, () => { editor.onCancel(); text.current?.blur(); }) : {})}
      className={`cursor-text select-text outline-none ${className}`}
    >
      {task.title}
    </span>
  );
}
