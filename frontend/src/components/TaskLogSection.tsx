import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { formatDate, t, useLanguage } from '../i18n';
import { TargetText } from './editor/TargetText';
import { fileDropText, targetFromElement } from './editor/targets';
import { openTarget, targetMenuItems } from './editor/contextMenu';
import type { EditorContextMenu, EditorContextMenuCallback, EditorTarget, TaskLogSectionHandle } from './editor/types';
import type { TaskLogEntry } from '../domain/types';
import { inlineTextHandlers } from './inlineEditor';
export type { TaskLogSectionHandle } from './editor/types';

export interface TaskLogSectionProps {
  entries: readonly TaskLogEntry[];
  onAdd(text: string): void | Promise<void>;
  onRemove(entryId: string): void | Promise<void>;
  onUpdate?(entryId: string, text: string): void | Promise<void>;
  taskId: string;
  onContextMenu: EditorContextMenuCallback;
  onCreateSourceTask?: (source: EditorTarget) => void | Promise<void>;
  onError(error: unknown): void;
}

export const TaskLogSection = forwardRef<TaskLogSectionHandle, TaskLogSectionProps>(function TaskLogSection(props, ref) {
  useLanguage();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string; token: object } | null>(null);
  const [editPending, setEditPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const currentEdit = useRef(editing); currentEdit.current = editing;
  const editSubmitting = useRef<object | null>(null);
  // Task identity alone is insufficient when switching away and back during an async operation.
  const taskSession = useRef({ taskId: props.taskId });
  if (taskSession.current.taskId !== props.taskId) taskSession.current = { taskId: props.taskId };
  const session = taskSession.current;
  const currentEntries = useRef(props.entries); currentEntries.current = props.entries;
  const submitting = useRef(false);
  useEffect(() => {
    setDraft(''); setPending(false); submitting.current = false;
    setEditing(null); setEditPending(false); editSubmitting.current = null;
  }, [props.taskId]);
  const statusText = (entry: TaskLogEntry) => entry.lifecycle === 'created' ? t('Task erstellt')
    : entry.lifecycle === 'completed' ? t('Task geschlossen') : t('Task erneut geöffnet');
  const dateLine = (entry: TaskLogEntry) => `${entry.lifecycle ? (entry.lifecycle === 'completed' ? '🟥 ' : '🟩 ') : '⬛ '}${formatDate(entry.createdAt, { hour: '2-digit', minute: '2-digit' })}${entry.lifecycle ? ` ${statusText(entry)}` : ''}`;
  const startEdit = (entry: TaskLogEntry) => {
    if (!props.onUpdate || entry.lifecycle || editSubmitting.current) return;
    const next = { id: entry.id, text: entry.text, token: {} };
    currentEdit.current = next; setEditing(next); setEditPending(false);
  };
  const cancelEdit = () => { currentEdit.current = null; setEditing(null); setEditPending(false); editSubmitting.current = null; };
  const saveEdit = async () => {
    if (!editing || taskSession.current !== session || currentEdit.current?.token !== editing.token
      || !props.onUpdate || !editing.text.trim() || editSubmitting.current) return;
    const { id, text, token } = editing;
    if (!currentEntries.current.some(entry => entry.id === id && !entry.lifecycle)) return;
    editSubmitting.current = token; setEditPending(true);
    try {
      await props.onUpdate(id, text.trim());
      if (taskSession.current === session && currentEdit.current?.token === token) {
        setEditing(current => current?.token === token && current.text === text ? null : current);
      }
    } catch (error) { props.onError(error); }
    finally {
      if (taskSession.current === session && editSubmitting.current === token) {
        editSubmitting.current = null; setEditPending(false);
      }
    }
  };
  useImperativeHandle(ref, () => ({
    focus: () => { input.current?.focus(); },
    insertFiles(paths) {
      const isEdit = !!editInput.current && document.activeElement === editInput.current;
      const field = isEdit ? editInput.current : input.current;
      if (!field || field.disabled || !paths.length) return;
      const activeSession = taskSession.current;
      const start = field.selectionStart, end = field.selectionEnd;
      const text = fileDropText(paths);
      if (isEdit) setEditing(value => value ? { ...value, text: value.text.slice(0, start) + text + value.text.slice(end) } : value);
      else setDraft(value => value.slice(0, start) + text + value.slice(end));
      requestAnimationFrame(() => { if (field.isConnected && taskSession.current === activeSession) { field.focus(); field.setSelectionRange(start + text.length, start + text.length); } });
    },
  }), []);
  const add = async () => {
    const text = draft.trim();
    if (!text || submitting.current) return;
    submitting.current = true; setPending(true);
    try {
      await props.onAdd(text);
      if (taskSession.current === session) setDraft(value => value === draft ? '' : value);
    } catch (error) { props.onError(error); }
    finally { if (taskSession.current === session) { submitting.current = false; setPending(false); } }
  };
  const logContext = (element: EventTarget, clipboardOnly = false): EditorContextMenu => {
       const target = clipboardOnly ? undefined : targetFromElement(element);
      const field = element === input.current ? input.current : element === editInput.current ? editInput.current : null;
      const editToken = field === editInput.current ? currentEdit.current?.token : undefined;
      const value = field?.value ?? '';
      const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
      const article = element instanceof Element ? element.closest<HTMLElement>('[data-log-entry]') : null;
      const entry = props.entries.find(entry => entry.id === article?.dataset.logEntry);
      const selection = window.getSelection();
      const selectedText = selection?.rangeCount && article?.contains(selection.getRangeAt(0).commonAncestorContainer)
        ? selection.toString() : '';
      const items = target ? targetMenuItems(target, !!props.onCreateSourceTask) : field
        ? [{ id: 'cut', label: t('Ausschneiden'), shortcut: 'Ctrl+X', disabled: start === end },
          { id: 'copy', label: t('Kopieren'), shortcut: 'Ctrl+C', disabled: start === end && !entry },
          { id: 'paste', label: t('Einfügen'), shortcut: 'Ctrl+V', disabled: false }]
         : entry ? [{ id: 'copy', label: t('Kopieren'), shortcut: 'Ctrl+C', disabled: false }] : [];
      if (entry && !entry.lifecycle && !field) {
        if (props.onUpdate) items.push({ id: 'edit', label: t('Log-Eintrag bearbeiten'), shortcut: 'F2', disabled: editPending });
        items.push({ id: 'delete', label: t('löschen'), shortcut: 'Del', disabled: false });
      }
      return { target, items, execute: async action => {
        if (taskSession.current !== session || !items.some(item => item.id === action && !item.disabled)) return;
        try {
          if (action === 'edit' && entry) {
            const current = currentEntries.current.find(current => current.id === entry.id && !current.lifecycle);
            if (current) startEdit(current);
            return;
          }
          if (action === 'source:create' && target) { await props.onCreateSourceTask?.(target); return; }
          if (action === 'delete' && entry) {
            if (currentEntries.current.some(current => current.id === entry.id && !current.lifecycle)) await props.onRemove(entry.id);
            return;
          }
          if (target) { await openTarget(target, action); return; }
          if (!field) { await navigator.clipboard.writeText(selectedText || (entry!.lifecycle ? dateLine(entry!) : `${dateLine(entry!)}\n${entry!.text}`)); return; }
          if (field.disabled || field.value !== value || !field.isConnected || (editToken && currentEdit.current?.token !== editToken)) return;
          if (action === 'copy' || action === 'cut') await navigator.clipboard.writeText(start !== end ? value.slice(start, end) : `${dateLine(entry!)}\n${value}`);
          const text = action === 'paste' ? await navigator.clipboard.readText() : '';
          if (action === 'copy' || taskSession.current !== session || field.disabled || field.value !== value || !field.isConnected
            || (editToken && currentEdit.current?.token !== editToken)) return;
          const next = value.slice(0, start) + text + value.slice(end);
          if (editToken) setEditing(current => current?.token === editToken && current.text === value ? { ...current, text: next } : current);
          else setDraft(current => current === value ? next : current);
          requestAnimationFrame(() => { if (field.isConnected && taskSession.current === session) { field.focus(); field.setSelectionRange(start + text.length, start + text.length); } });
        } catch (error) { props.onError(error); }
      } };
  };
  return <section data-task-selectable-text="true" data-task-log="true" className="flex h-full min-h-0 flex-col border-t border-slate-200"
    onClick={event => {
      const target = targetFromElement(event.target);
      if (target) { event.preventDefault(); event.stopPropagation(); void openTarget(target).catch(props.onError); }
    }} onKeyDownCapture={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const field = event.target instanceof HTMLTextAreaElement;
      const action = event.ctrlKey && !event.shiftKey ? ({ c: 'copy', x: 'cut', v: 'paste' } as Record<string, string>)[key]
        : !event.ctrlKey && !event.shiftKey && !field ? key === 'f2' ? 'edit' : key === 'delete' ? 'delete' : undefined : undefined;
      if (!action) return;
      const context = logContext(event.target, true);
      if (!context.items.some(item => item.id === action)) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) void context.execute(action);
    }} onKeyDown={event => {
      if (event.key !== 'Enter' || event.target instanceof HTMLTextAreaElement) return;
      const target = targetFromElement(event.target);
      if (target) { event.preventDefault(); void openTarget(target).catch(props.onError); }
    }} onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      props.onContextMenu(event, logContext(event.target));
    }}>
    <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Log')}</h3>
    <div className="flex-1 overflow-auto px-3 py-2 text-sm">
      {!props.entries.length && <p className="text-xs text-slate-400">{t('Keine Log-Einträge')}</p>}
      {props.entries.map(entry => <article key={entry.id} tabIndex={0} data-log-entry={entry.id} className={`${entry.lifecycle ? 'mb-1' : 'mb-3'} last:mb-0`}>
        <time dateTime={entry.createdAt} className="block mb-0.5 font-mono text-[10px] text-slate-400">
          {dateLine(entry)}
        </time>
        {!entry.lifecycle && <div className="relative" onClick={event => {
          if (event.target instanceof Element && event.target.closest('textarea, [data-target-kind]')) return;
          const selection = window.getSelection();
          if (selection?.toString() && selection.rangeCount && event.currentTarget.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
          event.stopPropagation(); startEdit(entry);
        }}>
          <div className={editing?.id === entry.id ? 'invisible' : undefined}>
            <TargetText text={entry.text} taskId={props.taskId} />
          </div>
          {editing?.id === entry.id && <textarea ref={editInput} autoFocus value={editing.text} disabled={editPending} aria-label={t('Log-Eintrag bearbeiten')}
            className="absolute inset-0 w-full h-full border-0 p-0 resize-none bg-transparent whitespace-pre-wrap break-words outline-none [font:inherit] [line-height:inherit]"
            onChange={event => setEditing(current => current ? { ...current, text: event.target.value } : current)}
            {...inlineTextHandlers(() => { void saveEdit(); }, () => {
              if (taskSession.current === session && currentEdit.current?.token === editing.token) cancelEdit();
            })} />}
        </div>}
      </article>)}
    </div>
    <form className="flex gap-2 border-t border-slate-100 p-2" onSubmit={event => { event.preventDefault(); void add(); }}>
      <textarea ref={input} value={draft} rows={2} aria-label={t('Notiz hinzufügen')} placeholder={t('Notiz hinzufügen')}
        className="flex-1 resize-none rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-sky-400"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); void add();
          }
        }} />
      <button type="submit" disabled={pending || !draft.trim()} title={t('Notiz senden')} aria-label={t('Notiz senden')}
        className="self-end rounded p-2 text-sky-700 hover:bg-sky-50 disabled:opacity-40"><Send size={16} /></button>
    </form>
  </section>;
});
