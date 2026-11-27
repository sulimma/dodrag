import { openTarget } from './editor/contextMenu';
import { TaskTimingInput } from './TaskTimingInput';
import type { TaskTiming } from '../domain/duration';
import React, { useEffect, useRef, useState } from 'react';
import { ListEnd, X, ArrowRight, Check, Flame, RotateCcw, PanelLeftClose, PanelLeftOpen, CircleHelp } from 'lucide-react';
import { eventBridge, type TaskMenuItem } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import { t, formatDate } from '../i18n';
import { TaskTitle } from './TaskTitle';
import { TaskDate } from './TaskDate';
import { TaskDragHandle } from './TaskDragHandle';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import type { InlineEditor } from './inlineEditor';
import { taskDragSourceInteractions, taskDropTargetInteractions, type TaskViewInteractions } from './taskInteractions';
import { taskAppearanceRole } from './taskAppearance';
import { executeTaskMenuAction, taskMenuItems, projectMenuSources, type TaskMenuActions } from './TaskContextMenu';
import { TaskDescriptionEditor, type TaskDescriptionEditorHandle } from './editor/TaskDescriptionEditor';
import type { EditorContextMenu, EditorTarget } from './editor/types';
import { TaskLogSection, type TaskLogSectionHandle } from './TaskLogSection';
import { ResizeHandle } from './ResizeHandle';
import { shortcutLabel } from '../hooks/keyboardNavigation';
import { menuPosition, useContextMenu } from './ContextMenuPopup';

interface TaskDetailPanelProps extends TaskMenuActions {
  task: TaskState | null;
  tasks?: Record<string, TaskState>;
  projectDescriptions?: string[];
  active?: boolean;
  onNativeMenuChange?: (open: boolean) => void;
  interactions: TaskViewInteractions;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
  onClose: () => void;
  open?: boolean;
  onToggle?: () => void;
  onSyntaxHelp?: () => void;
  detailAction?: React.ReactNode;
  detailSection?: React.ReactNode;
  onTimingChange?: (taskId: string, timing: TaskTiming) => Promise<void>;
  descriptionSaveState?: 'saving' | 'saved' | 'error';
  onDescriptionChange: (taskId: string, markdown: string) => void;
  onDescriptionCommit?: (taskId: string) => void;
  onAddLog: (taskId: string, text: string) => Promise<void>;
  onRemoveLog: (taskId: string, entryId: string) => Promise<void>;
  onUpdateLog?: (taskId: string, entryId: string, text: string) => Promise<void>;
  onCreateSourceTask?: (source: EditorTarget) => void | Promise<void>;
  onError: (error: unknown) => void;
}

// Width follows the viewport immediately, including native restore and maximization.
const dateLabelCSS = '@container task-detail (max-width: 440px) { .detail-date-label { display: none; } } [data-task-detail-panel]:has([data-resize-dragging]) { transition: none; }';

export function TaskDetailPanel(props: TaskDetailPanelProps) {
  const showMenu = useContextMenu();
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
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => eventBridge.onFileDrop((x, y, paths) => {
    if (latest.current.active === false || latest.current.open === false || !latest.current.task || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const hit = document.elementFromPoint?.(x, y);
    if (hit && !hit.closest('[data-description-editor], [data-task-log]')) return;
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
    const position = menuPosition(event);
    props.onNativeMenuChange?.(true);
    try {
      const sources = await projectMenuSources(context ? [] : props.projectDescriptions);
      const items: TaskMenuItem[] = context ? context.items : [...taskMenuItems(task), ...sources.items];
      if (!items.length || latest.current.task?.id !== original || latest.current.active === false) return;
      const id = await showMenu(items, position);
      const current = latest.current;
      if (current.active === false || current.task?.id !== original || !items.some(item => item.id === id && !item.disabled && !item.separator)) return;
      if (context) await context.execute(id);
      else if (sources.target(id)) await openTarget(sources.target(id)!);
      else executeTaskMenuAction(id, current.task, current);
    } catch (error) { latest.current.onError(error); }
    finally { props.onNativeMenuChange?.(false); }
  };
  const key = task ? `detail-task:${task.id}` : '';
  const appearance = task && taskAppearanceRole(task, interactions.highlights[task.id] ?? null,
    interactions.activeDropTargetKey === key && interactions.draggedTaskId !== task.id, interactions.isAltDrag);
  return (
    <aside ref={panel} tabIndex={0} aria-label={t('Task-Details')}
      data-task-detail-panel="true" data-shortcut-region={open ? '2' : undefined}
      {...(task && open ? taskDropTargetInteractions(task.id, key, interactions) : {})}
      onDragOver={event => {
        if (open && task && interactions.draggedTaskId) taskDropTargetInteractions(task.id, key, interactions).onDragOver(event);
        else event.preventDefault(); // Preserve Wails' copy cursor and native target highlighting.
      }}
      onDrop={event => {
        // Explorer paths arrive through Wails, never through untrusted DOM text/plain.
        if (open && task && interactions.draggedTaskId) taskDropTargetInteractions(task.id, key, interactions).onDrop(event);
        else event.preventDefault(); // Wails resolves Explorer paths in its window bubble listener.
      }}
      data-deletion-preview={open && task && interactions.deletionPreview.some(edge => edge.endsWith(`->${task.id}`)) || undefined}
      style={{ '--wails-drop-target': open && task ? 'drop' : 'none', '--detail-width': `min(${detailWidth}px, max(200px, calc(100vw - 300px)))`, width: open ? 'var(--detail-width)' : 'calc(1.75rem + 1px)' } as React.CSSProperties}
      onContextMenu={event => void contextMenu(event)}
      onMouseDown={event => {
        if (!(event.target as HTMLElement).closest('input,textarea,button,a,select,[contenteditable="true"],[data-task-selectable-text]')) panel.current?.focus();
      }}
      className={`relative shrink-0 overflow-hidden border-r min-h-0 bg-white/95 outline-none ${appearance === 'drop' && open ? 'border-amber-400 ring-2 ring-inset ring-amber-400/50 bg-amber-50' : 'border-slate-200'}`}>
        {open && <ResizeHandle orientation="vertical" label={t('Breite der Detailansicht ändern')}
          value={panel.current?.getBoundingClientRect().width || detailWidth} limits={widthLimits} onChange={setDetailWidth} />}
        {open && props.onSyntaxHelp && <button type="button" title={t('Markdown-Syntax')} aria-label={t('Markdown-Syntax')}
          onClick={props.onSyntaxHelp}
          className="absolute top-3 right-7 z-20 flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-500">
          <CircleHelp className="h-5 w-5" aria-hidden="true" />
        </button>}
        <button data-detail-toggle type="button" title={shortcutLabel(open ? t('Details schließen') : t('Details anzeigen'), 'Ctrl+Shift+D')} aria-keyshortcuts="Control+Shift+D"
          aria-label={open ? t('Details schließen') : t('Details anzeigen')} aria-expanded={open}
          onClick={props.onToggle ?? props.onClose}
          className="absolute top-3 right-0 z-20 flex h-7 w-7 items-center justify-center rounded-l text-slate-500 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-500">
          {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
        </button>
      {open && <div className="absolute inset-y-0 left-0 flex flex-col min-h-0" style={{ width: 'var(--detail-width)', containerType: 'inline-size', containerName: 'task-detail' }}>
      <style>{dateLabelCSS}</style>
      <header {...(task ? taskDragSourceInteractions(task.id, interactions) : {})}
        data-task-drag-disabled={task && (titleEditor.taskId === task.id || dateEditor.taskId === task.id) || undefined}
        className={`p-3 border border-slate-200 space-y-3 shrink-0 ${task ? 'cursor-grab rounded bg-slate-50/50' : ''}`}>
        <div className="flex items-center gap-2 pr-14">
          {task && <><TaskDragHandle /><span className="font-mono text-xs px-2 py-1 bg-slate-100 rounded">{task.id}</span>
            <TaskChecklistBadge progress={task.checklistProgress} />
            <button type="button" title={t('Nachfolger anlegen')} aria-label={t('Nachfolger anlegen')}
              className="rounded p-1 text-slate-600 hover:bg-sky-100" onClick={() => props.onCreateSuccessor(task.id)}><ListEnd size={16}/></button>
            {!task.completed && <button type="button" title={task.isActive ? t('Deaktivieren (Space)') : t('Aktivieren (Space)')}
              className={`p-1 rounded ${task.isActive ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-emerald-600'}`}
              onClick={() => props.onToggleActive(task)}><Flame size={16} /></button>}
            {props.interactions.renderTaskTimer?.(task)}
            <button type="button" title={task.completed ? t('Erneut öffnen') : t('Als erledigt markieren')}
              className="p-1 rounded text-slate-500 hover:text-emerald-600"
              onClick={() => task.completed ? props.onReopenTask(task.id) : props.onCompleteTask(task.id)}>
              {task.completed ? <RotateCcw size={16} /> : <Check size={16} />}</button></>}
        </div>
        {task && <><div className="flex items-start gap-2"><div className="min-w-0 flex-1" data-task-title-area><TaskTitle task={task} editor={titleEditor} className="text-base font-semibold break-words" /></div>
          <TaskTimingInput key={task.id} value={task} onSave={async timing => { await props.onTimingChange?.(task.id, timing); }} onError={props.onError} /></div>
          <div data-detail-dates className="text-xs text-slate-500 flex items-center gap-1 whitespace-nowrap min-w-0">
            <span className="detail-date-label">{t('Konfiguriert')}:</span><TaskDate task={task} editor={dateEditor} compact />
            <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="detail-date-label">{t('Berechnet')}:</span>
            <span className="font-mono" title={t('Berechnet')}>{formatDate(task.calculatedStart ?? task.effectiveStart)}</span>
            <div ref={setHistoryTarget} className="ml-auto flex shrink-0" data-detail-history />
          </div>{props.detailAction}</>}
      </header>
      {props.detailSection}
      {!task ? <p className="p-6 text-sm text-slate-400">{t('Task auswählen, um Details, Beschreibung und Log anzuzeigen')}</p> : <>
        <div role="status" aria-live="polite" data-description-save-state={props.descriptionSaveState}
          className={`px-3 text-xs shrink-0 ${props.descriptionSaveState === 'error' ? 'text-red-700' : 'text-slate-500'}`}>
          {props.descriptionSaveState === 'error' ? t('Beschreibung nicht gespeichert – erneuter Versuch läuft')
            : props.descriptionSaveState === 'saving' ? t('Beschreibung wird gespeichert…') : t('Beschreibung gespeichert')}
        </div>
        <section className="flex flex-col flex-1 min-h-0 overflow-hidden" data-task-selectable-text="true" data-shortcut-region="3">
          <TaskDescriptionEditor ref={editor} taskId={task.id} description={task.description} active={props.active} historyTarget={historyTarget}
            onCreateSourceTask={props.onCreateSourceTask}
            onChange={markdown => props.onDescriptionChange(task.id, markdown)}
            onCommit={() => props.onDescriptionCommit?.(task.id)}
            onEscape={() => panel.current?.focus()} onContextMenu={(event, context) => void contextMenu(event, context)} onError={props.onError} />
        </section>
        {props.tasks && <DetailRelations key={task.id} task={task} tasks={props.tasks} interactions={interactions} remove={props.onRemovePredecessor}/>}
        <ResizeHandle orientation="horizontal" label={t('Höhe des Logs ändern')} direction={-1}
          value={logArea.current?.getBoundingClientRect().height || logHeight} limits={heightLimits} onChange={setLogHeight} />
        <div ref={logArea} className="min-h-0 shrink-0 overflow-hidden" style={{ height: `min(${logHeight}px, max(100px, calc(100% - 290px)))` }} data-task-selectable-text="true" data-shortcut-region="4">
          <TaskLogSection key={task.id} ref={log} taskId={task.id} entries={task.logEntries}
            onCreateSourceTask={props.onCreateSourceTask}
            onAdd={text => props.onAddLog(task.id, text)} onRemove={entryId => props.onRemoveLog(task.id, entryId)}
            onUpdate={props.onUpdateLog ? (entryId, text) => props.onUpdateLog!(task.id, entryId, text) : undefined}
            onContextMenu={(event, context) => void contextMenu(event, context)} onError={props.onError} />
        </div>
      </>}
      </div>}
    </aside>
  );
}

function DetailRelations({ task, tasks, interactions, remove }: {
  task: TaskState; tasks: Record<string, TaskState>; interactions: TaskViewInteractions;
  remove(taskId: string, predecessorId: string): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Include completed neighbors too. The graph views project only open edges.
  const groups = React.useMemo(() => [
    { label: 'Vorgänger', incoming: true, neighbors: task.allPredecessorIds.map(id => tasks[id]).filter(Boolean) },
    { label: 'Nachfolger', incoming: false, neighbors: Object.values(tasks).filter(other => other.allPredecessorIds.includes(task.id)) },
  ], [task.id, task.allPredecessorIds, tasks]);
  if (groups.every(group => !group.neighbors.length)) return null;
  return <div className="max-h-[25%] overflow-y-auto shrink-0 border-t px-3 py-1">
    {groups.map(({ label, incoming, neighbors }) => neighbors.length > 0 && <section key={label} aria-label={t(label)} className="flex items-baseline gap-2 py-0.5">
      <h3 className="w-20 shrink-0 text-xs text-slate-500">{t(label)}</h3>
      <div className="flex flex-wrap gap-1 min-w-0">{neighbors.map(other => {
        const [from, to] = incoming ? [other.id, task.id] : [task.id, other.id];
        const edge = from + '->' + to;
        return <span key={edge} onContextMenu={e => interactions.onContextMenuTask(e, task.id, {
          id: other.id, direction: incoming ? 'predecessor' : 'successor',
        })} className={'inline-flex min-w-0 max-w-full rounded border text-xs ' +
          (incoming
            ? selected === edge ? 'bg-amber-100 text-amber-950 border-amber-500 ring-1 ring-amber-400' : 'bg-amber-50 text-amber-800 border-amber-200'
            : selected === edge ? 'bg-purple-100 text-purple-950 border-purple-500 ring-1 ring-purple-400' : 'bg-purple-50 text-purple-800 border-purple-200')}>
          <button type="button" {...taskDragSourceInteractions(other.id, interactions)} data-detail-relation={edge}
            {...taskDropTargetInteractions(other.id, 'detail-relation:' + edge, interactions)}
            aria-pressed={selected === edge} title={other.title}
            className="min-w-0 truncate px-1.5 py-0.5 cursor-grab"
            onDragStart={e => interactions.onDragStartTask(e, other.id, true)}
            onClick={() => setSelected(edge)}
            onKeyDown={e => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault(); e.stopPropagation(); if (selected === edge) remove(to, from);
              }
            }}><span className="font-mono">{other.id}</span> {other.title}</button>
          <button type="button" title={t('Abhängigkeit entfernen')} aria-label={t('Abhängigkeit entfernen')}
            className="px-1 text-slate-500 hover:text-red-700" onClick={() => remove(to, from)}><X size={12}/></button>
        </span>;
      })}</div>
    </section>)}
  </div>;
}
