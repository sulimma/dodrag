import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Flame, RotateCcw, PanelLeftClose, PanelLeftOpen, CircleHelp } from 'lucide-react';
import { eventBridge } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import { t, formatDate } from '../i18n';
import { TaskTitle } from './TaskTitle';
import { TaskDate } from './TaskDate';
import { TaskDragHandle } from './TaskDragHandle';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import type { InlineEditor } from './inlineEditor';
import { taskDragDropInteractions, type TaskViewInteractions } from './taskInteractions';
import { taskAppearanceRole } from './taskAppearance';
import { executeTaskMenuAction, taskMenuItems, type TaskMenuActions } from './TaskContextMenu';
import { TaskDescriptionEditor, type TaskDescriptionEditorHandle } from './editor/TaskDescriptionEditor';
import type { EditorContextMenu } from './editor/types';
import { TaskLogSection, type TaskLogSectionHandle } from './TaskLogSection';
import { ResizeHandle } from './ResizeHandle';

interface TaskDetailPanelProps extends TaskMenuActions {
  task: TaskState | null;
  interactions: TaskViewInteractions;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
  onClose: () => void;
  open?: boolean;
  onToggle?: () => void;
  onSyntaxHelp?: () => void;
  onDescriptionChange: (taskId: string, markdown: string, groupId: string) => Promise<void>;
  onAddLog: (taskId: string, text: string) => Promise<void>;
  onRemoveLog: (taskId: string, entryId: string) => Promise<void>;
  onError: (error: unknown) => void;
}

const dateLabelCSS = '@container task-detail (max-width: 440px) { .detail-date-label { display: none; } } [data-task-detail-panel]:has([data-resize-dragging]) { transition: none; }';

export function TaskDetailPanel(props: TaskDetailPanelProps) {
  const { task, interactions, titleEditor, dateEditor, open = true } = props;
  const panel = useRef<HTMLElement>(null);
  const editor = useRef<TaskDescriptionEditorHandle>(null);
  const log = useRef<TaskLogSectionHandle>(null);
  const logArea = useRef<HTMLDivElement>(null);
  const [historyTarget, setHistoryTarget] = useState<HTMLDivElement | null>(null);
  const [detailWidth, setDetailWidth] = useState(560);
  const [logHeight, setLogHeight] = useState(224);
  const widthLimits = (): [number, number] => {
    const available = panel.current?.parentElement?.clientWidth || window.innerWidth;
    const maximum = Math.max(200, available - Math.min(280, available / 2));
    return [Math.min(300, maximum), maximum];
  };
  const heightLimits = (): [number, number] => {
    const height = panel.current?.clientHeight || window.innerHeight;
    const header = panel.current?.querySelector('header')?.getBoundingClientRect().height || 150;
    return [100, Math.max(100, height - header - 140)];
  };
  const [session] = useState(() => crypto.randomUUID());
  const descriptionGroup = useRef(session);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => eventBridge.onFileDrop((x, y, paths) => {
    if (latest.current.open === false || !latest.current.task || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const logBounds = logArea.current?.getBoundingClientRect();
    try {
      if (logBounds && y >= logBounds.top) log.current?.insertFiles(paths, x, y);
      else editor.current?.insertFiles(paths, x, y);
    } catch (error) { latest.current.onError(error); }
  }), []);

  const contextMenu = async (event: React.MouseEvent, context?: EditorContextMenu) => {
    event.preventDefault();
    event.stopPropagation();
    if (!task) return;
    const original = task.id;
    const items = context ? context.items : taskMenuItems(task);
    if (!items.length) return;
    try {
      const id = await eventBridge.showTaskContextMenu(items);
      const current = latest.current;
      if (current.task?.id !== original || !items.some(item => item.id === id && !item.disabled && !item.separator)) return;
      if (context) await context.execute(id);
      else executeTaskMenuAction(id, current.task, current);
    } catch (error) { latest.current.onError(error); }
  };
  const key = task ? `detail-task:${task.id}` : '';
  const appearance = task && taskAppearanceRole(task, interactions.highlights[task.id] ?? null,
    interactions.activeDropTargetKey === key && interactions.draggedTaskId !== task.id, interactions.isAltDrag);
  return (
    <aside ref={panel} tabIndex={0} aria-label={t('Task-Details')}
      data-task-detail-panel="true"
      {...(task && open ? taskDragDropInteractions(task.id, key, interactions) : {})}
      onDragOver={event => {
        if (open && task && interactions.draggedTaskId) taskDragDropInteractions(task.id, key, interactions).onDragOver(event);
        else event.preventDefault(); // Preserve Wails' copy cursor and native target highlighting.
      }}
      onDrop={event => {
        // Explorer paths arrive through Wails, never through untrusted DOM text/plain.
        if (open && task && interactions.draggedTaskId) taskDragDropInteractions(task.id, key, interactions).onDrop(event);
        else event.preventDefault(); // Wails resolves Explorer paths in its window bubble listener.
      }}
      data-task-drag-disabled={task && (titleEditor.taskId === task.id || dateEditor.taskId === task.id) || undefined}
      data-deletion-preview={open && task && interactions.deletionPreview.some(edge => edge.endsWith(`->${task.id}`)) || undefined}
      style={{ '--wails-drop-target': open && task ? 'drop' : 'none', '--detail-width': `min(${detailWidth}px, max(200px, calc(100vw - 300px)))`, width: open ? 'var(--detail-width)' : 'calc(1.75rem + 1px)' } as React.CSSProperties}
      onContextMenu={event => void contextMenu(event)}
      onMouseDown={event => {
        if (!(event.target as HTMLElement).closest('input,textarea,button,a,select,[contenteditable="true"],[data-task-selectable-text]')) panel.current?.focus();
      }}
      className={`relative shrink-0 overflow-hidden border-r min-h-0 bg-white/95 outline-none transition-[width] duration-300 ease-in-out motion-reduce:transition-none ${appearance === 'drop' && open ? 'border-amber-400 ring-2 ring-inset ring-amber-400/50 bg-amber-50' : 'border-slate-200'}`}>
        {open && <ResizeHandle orientation="vertical" label={t('Breite der Detailansicht ändern')}
          value={panel.current?.getBoundingClientRect().width || detailWidth} limits={widthLimits} onChange={setDetailWidth} />}
        {open && props.onSyntaxHelp && <button type="button" title={t('Markdown-Syntax')} aria-label={t('Markdown-Syntax')}
          onClick={props.onSyntaxHelp}
          className="absolute top-3 right-7 z-20 flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-500">
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
        </button>}
        <button data-detail-toggle type="button" title={open ? t('Details schließen') : t('Details anzeigen')}
          aria-label={open ? t('Details schließen') : t('Details anzeigen')} aria-expanded={open}
          onClick={props.onToggle ?? props.onClose}
          className="absolute top-3 right-0 z-20 flex h-7 w-7 items-center justify-center rounded-l text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-500">
          {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
        </button>
      {open && <div className="absolute inset-y-0 left-0 flex flex-col min-h-0" style={{ width: 'var(--detail-width)', containerType: 'inline-size', containerName: 'task-detail' }}>
      <style>{dateLabelCSS}</style>
      <header className="p-3 border-b border-slate-200 space-y-3 shrink-0">
        <div className={`flex items-center gap-2 ${props.onSyntaxHelp ? 'pr-12' : 'pr-6'}`}>
          {task && <><TaskDragHandle /><span className="font-mono text-xs px-2 py-1 bg-slate-100 rounded">{task.id}</span>
            <TaskChecklistBadge progress={task.checklistProgress} />
            {!task.completed && <button type="button" title={task.isActive ? t('Deaktivieren (Space)') : t('Aktivieren (Space)')}
              className={`p-1 rounded ${task.isActive ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-emerald-600'}`}
              onClick={() => props.onToggleActive(task)}><Flame size={16} /></button>}
            <button type="button" title={task.completed ? t('Erneut öffnen') : t('Als erledigt markieren')}
              className="p-1 rounded text-slate-500 hover:text-emerald-600"
              onClick={() => task.completed ? props.onReopenTask(task.id) : props.onCompleteTask(task.id)}>
              {task.completed ? <RotateCcw size={16} /> : <Check size={16} />}</button></>}
        </div>
        {task && <><div data-task-title-area><TaskTitle task={task} editor={titleEditor} className="text-base font-semibold break-words" /></div>
          <div data-detail-dates className="text-xs text-slate-500 flex items-center gap-1 whitespace-nowrap min-w-0">
            <span className="detail-date-label">{t('Konfiguriert')}:</span><TaskDate task={task} editor={dateEditor} compact />
            <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="detail-date-label">{t('Berechnet')}:</span>
            <span className="font-mono" title={t('Berechnet')}>{formatDate(task.calculatedStart ?? task.effectiveStart)}</span>
            <div ref={setHistoryTarget} className="ml-auto flex shrink-0" data-detail-history />
          </div></>}
      </header>
      {!task ? <p className="p-6 text-sm text-slate-400">{t('Task auswählen, um Details, Beschreibung und Log anzuzeigen')}</p> : <>
        <section className="flex flex-col flex-1 min-h-0 overflow-hidden" data-task-selectable-text="true">
          <TaskDescriptionEditor ref={editor} taskId={task.id} description={task.description} historyTarget={historyTarget}
            onChange={(markdown, metadata) => {
              const discrete = metadata?.historyBoundary || metadata?.localUndo;
              const group = discrete ? crypto.randomUUID() : descriptionGroup.current;
              if (discrete) descriptionGroup.current = crypto.randomUUID();
              props.onDescriptionChange(task.id, markdown, `desc-${task.id}-${group}`).catch(props.onError);
            }}
            onEscape={() => panel.current?.focus()} onContextMenu={(event, context) => void contextMenu(event, context)} onError={props.onError} />
        </section>
        <ResizeHandle orientation="horizontal" label={t('Höhe des Logs ändern')} direction={-1}
          value={logArea.current?.getBoundingClientRect().height || logHeight} limits={heightLimits} onChange={setLogHeight} />
        <div ref={logArea} className="min-h-0 shrink-0 overflow-hidden" style={{ height: `min(${logHeight}px, max(100px, calc(100% - 290px)))` }} data-task-selectable-text="true">
          <TaskLogSection key={task.id} ref={log} taskId={task.id} entries={task.logEntries}
            onAdd={text => props.onAddLog(task.id, text)} onRemove={entryId => props.onRemoveLog(task.id, entryId)}
            onContextMenu={(event, context) => void contextMenu(event, context)} onError={props.onError} />
        </div>
      </>}
      </div>}
    </aside>
  );
}
