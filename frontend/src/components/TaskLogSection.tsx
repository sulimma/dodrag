import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { formatDate, t, useLanguage } from '../i18n';
import { TargetText } from './editor/TargetText';
import { fileDropText, targetFromElement } from './editor/targets';
import { openTarget, targetMenuItems } from './editor/contextMenu';
import type { EditorContextMenuCallback, EditorTarget, TaskLogSectionHandle } from './editor/types';
export type { TaskLogSectionHandle } from './editor/types';

export interface TaskLogSectionProps {
  entries: readonly { id: string; text: string; createdAt: string }[];
  onAdd(text: string): void | Promise<void>;
  onRemove(entryId: string): void | Promise<void>;
  taskId: string;
  onContextMenu: EditorContextMenuCallback;
  onCreateSourceTask?: (source: EditorTarget) => void | Promise<void>;
  onError(error: unknown): void;
}

export const TaskLogSection = forwardRef<TaskLogSectionHandle, TaskLogSectionProps>(function TaskLogSection(props, ref) {
  useLanguage();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentTask = useRef(props.taskId); currentTask.current = props.taskId;
  const currentEntries = useRef(props.entries); currentEntries.current = props.entries;
  const submitting = useRef(false);
  useEffect(() => { setDraft(''); setPending(false); submitting.current = false; }, [props.taskId]);
  useImperativeHandle(ref, () => ({
    focus: () => { input.current?.focus(); },
    insertFiles(paths) {
      const field = input.current;
      if (!field || !paths.length) return;
      const start = field.selectionStart, end = field.selectionEnd;
      const text = fileDropText(paths);
      setDraft(value => value.slice(0, start) + text + value.slice(end));
      requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + text.length, start + text.length); });
    },
  }), []);
  const add = async () => {
    const text = draft.trim();
    if (!text || submitting.current) return;
    const taskId = props.taskId;
    submitting.current = true; setPending(true);
    try {
      await props.onAdd(text);
      if (currentTask.current === taskId) setDraft(value => value === draft ? '' : value);
    } catch (error) { props.onError(error); }
    finally { if (currentTask.current === taskId) { submitting.current = false; setPending(false); } }
  };
  return <section data-task-selectable-text="true" data-task-log="true" className="flex h-full min-h-0 flex-col border-t border-slate-200"
    onClick={event => {
      const target = targetFromElement(event.target);
      if (target) { event.preventDefault(); event.stopPropagation(); void openTarget(target).catch(props.onError); }
    }} onKeyDown={event => {
      if (event.key !== 'Enter' || event.target instanceof HTMLTextAreaElement) return;
      const target = targetFromElement(event.target);
      if (target) { event.preventDefault(); void openTarget(target).catch(props.onError); }
    }} onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      const target = targetFromElement(event.target);
      const field = event.target === input.current ? input.current : null;
      const value = field?.value ?? '';
      const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
      const article = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-log-entry]') : null;
      const entry = props.entries.find(entry => entry.id === article?.dataset.logEntry);
      const selection = window.getSelection();
      const selectedText = selection?.rangeCount && article?.contains(selection.getRangeAt(0).commonAncestorContainer)
        ? selection.toString() : '';
      const items = target ? targetMenuItems(target, !!props.onCreateSourceTask) : field
        ? [{ id: 'cut', label: t('Ausschneiden'), disabled: start === end },
          { id: 'copy', label: t('Kopieren'), disabled: start === end },
          { id: 'paste', label: t('Einfügen'), disabled: false }]
         : entry ? [{ id: 'copy', label: t('Kopieren'), disabled: false }] : [];
      if (entry) items.push({ id: 'delete', label: t('löschen'), disabled: false });
      props.onContextMenu(event, { target, items, execute: async action => {
        if (currentTask.current !== props.taskId || !items.some(item => item.id === action && !item.disabled)) return;
        try {
          if (action === 'source:create' && target) { await props.onCreateSourceTask?.(target); return; }
          if (action === 'delete' && entry) {
            if (currentEntries.current.some(current => current.id === entry.id)) await props.onRemove(entry.id);
            return;
          }
          if (target) { await openTarget(target, action); return; }
          if (!field) { await navigator.clipboard.writeText(selectedText || entry!.text); return; }
          if (field.value !== value) return;
          if (action === 'copy' || action === 'cut') await navigator.clipboard.writeText(value.slice(start, end));
          const text = action === 'paste' ? await navigator.clipboard.readText() : '';
          if (action === 'copy' || currentTask.current !== props.taskId || field.value !== value) return;
          setDraft(current => current === value ? value.slice(0, start) + text + value.slice(end) : current);
          requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + text.length, start + text.length); });
        } catch (error) { props.onError(error); }
      } });
    }}>
    <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Log')}</h3>
    <div className="flex-1 overflow-auto px-3 py-2 text-sm">
      {!props.entries.length && <p className="text-xs text-slate-400">{t('Keine Log-Einträge')}</p>}
      {props.entries.map(entry => <article key={entry.id} data-log-entry={entry.id} className="mb-3 last:mb-0">
        <time dateTime={entry.createdAt} className="block mb-0.5 font-mono text-[10px] text-slate-400">
          {formatDate(entry.createdAt, { hour: '2-digit', minute: '2-digit' })}
        </time>
        <TargetText text={entry.text} taskId={props.taskId} />
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
