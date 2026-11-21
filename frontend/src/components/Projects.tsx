import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { Project } from '../domain/projects';
import { formatNumber, t } from '../i18n';
import { TaskDescriptionEditor } from './editor/TaskDescriptionEditor';
import { eventBridge } from '../bridge/eventBridge';
import { TaskLogSection } from './TaskLogSection';
import type { TaskLogEntry } from '../domain/types';
import { ResizeHandle } from './ResizeHandle';
import type { EditorContextMenuCallback, TaskDescriptionEditorHandle, TaskLogSectionHandle } from './editor/types';
import { contextMenuAnchor } from '../hooks/keyboardNavigation';

export const ProjectContext = createContext<{
  projects: Map<string, Project>;
  members: Map<string, Set<string>>;
  selectedIds: string[];
  selectedLabels: readonly { taskId: string; projectId: string }[];
  select(projectId: string, event: React.MouseEvent, taskId?: string): void;
  details(projectId: string): void;
  menu(projectId: string, event: React.MouseEvent): void;
  remove(taskId: string, projectId: string): void;
} | null>(null);

function Chip({ project, taskId, insertion }: {
  project: Project; taskId?: string; insertion?: 'before' | 'after';
}) {
  const actions = useContext(ProjectContext)!;
  const selected = taskId
    ? actions.selectedLabels.some(label => label.taskId === taskId && label.projectId === project.projectId)
    : actions.selectedIds.includes(project.projectId);
  const { code, color, projectId, summary } = project;
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  // Keep white lettering readable even when the chosen project color is pastel.
  const luminance = (scale: number) => rgb.reduce((sum, channel, i) => {
    const s = channel * scale / 255;
    return sum + [0.2126, 0.7152, 0.0722][i] * (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4);
  }, 0);
  let scale = 1;
  while (luminance(scale) > .18) scale *= .95;
  const ink = 'rgb(' + rgb.map(channel => Math.floor(channel * scale)).join(' ') + ')';
  return <button type="button" data-context-menu-target data-project-drag={projectId} data-project-task={taskId} data-task-drop-target={taskId ? undefined : projectId}
    title={summary || code} aria-pressed={selected} onDragStart={e => {
      e.stopPropagation();
      e.dataTransfer.setData('application/x-dodrag-project', projectId);
      if (taskId) e.dataTransfer.setData('application/x-dodrag-member', taskId);
    }} onClick={e => { e.stopPropagation(); e.currentTarget.focus(); if (e.detail < 2) actions.select(projectId, e, taskId); }}
    onDoubleClick={e => { e.stopPropagation(); actions.details(projectId); }}
    onFocus={e => e.stopPropagation()}
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); actions.menu(projectId, e); }}
    data-project-insert={insertion}
    onKeyDown={e => { if (taskId && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); e.stopPropagation(); if (selected) actions.remove(taskId, projectId); } }}
    style={{ backgroundColor: selected ? ink : 'color-mix(in srgb, ' + color + ' 10%, white)',
      color: selected ? 'white' : '#18202b', borderColor: 'color-mix(in srgb, ' + ink + (selected ? ' 90%' : ' 52%') + ', white)' }}
    className="shrink-0 rounded border px-1.5 py-px font-mono text-[11px] font-semibold leading-tight cursor-grab focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-offset-1">{code}</button>;
}

export function ProjectLabels({ taskId }: { taskId: string }) {
  const ctx = useContext(ProjectContext);
  if (!ctx?.members.get(taskId)?.size) return null;
  return <span className="inline-flex max-w-full items-center gap-1 overflow-x-auto align-middle">
    {[...ctx.members.get(taskId)!].map(id => {
      const project = ctx.projects.get(id);
      return project && <Chip key={id} project={project} taskId={taskId}/>;
    })}
  </span>;
}

export function ProjectList({ projects, clear, create, enabled, onTaskDrop, reorder }: {
  projects: Project[]; reorder(id: string, before: string | null): void; clear(): void;
  create(code: string): Promise<boolean>; enabled: boolean;
  onTaskDrop(projectId: string): void;
}) {
  const [insertion, setInsertion] = useState<string | null | undefined>();
  const findBefore = (e: React.DragEvent<HTMLElement>) => {
    for (const chip of e.currentTarget.querySelectorAll<HTMLElement>('[data-project-drag]')) {
      const rect = chip.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) return chip.dataset.projectDrag!;
    }
    return null;
  };
  const isReorder = (e: React.DragEvent) => e.dataTransfer.types.includes('application/x-dodrag-project') &&
    !e.dataTransfer.types.includes('application/x-dodrag-member');
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const busy = useRef(false);
  return <section aria-label={t('Projekte')} data-project-list data-task-drop-target="project-list"
    onClick={event => { if (event.target === event.currentTarget) clear(); }}
    className="flex shrink-0 items-center gap-1.5 bg-white border-b border-slate-200 px-2 py-1.5 overflow-x-auto"
    onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (isReorder(e)) setInsertion(findBefore(e)); }}
    onDragLeave={() => setInsertion(undefined)} onDragEnd={() => setInsertion(undefined)}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); setInsertion(undefined);
      if (isReorder(e)) { reorder(e.dataTransfer.getData('application/x-dodrag-project'), findBefore(e)); return; }
      const id = (e.target as Element).closest<HTMLElement>('[data-project-drag]')?.dataset.projectDrag; if (id) onTaskDrop(id); }}>
    <button type="button" disabled={!enabled} aria-label={t('Projekt anlegen')} title={t('Projekt anlegen')} onClick={() => setAdding(!adding)}><Plus size={15}/></button>
    {adding && <form className="flex items-center" onSubmit={async e => { e.preventDefault(); if (busy.current) return; busy.current = true;
      try { if (await create(code)) { setAdding(false); setCode(''); } } finally { busy.current = false; }
    }}><input autoFocus required pattern="[A-Z0-9]{2,8}" maxLength={8} aria-label={t('Projektkürzel')} placeholder={t('Projektkürzel')} value={code}
      className="w-20 border rounded px-1 text-xs" onChange={e => setCode(e.target.value.toUpperCase())} /><button type="submit" aria-label={t('Projekt anlegen')}><Check size={14}/></button></form>}
    {projects.map((project, i) => <Chip key={project.projectId} project={project}
      insertion={insertion === project.projectId ? 'before' : insertion === null && i === projects.length - 1 ? 'after' : undefined}/>)}
  </section>;
}

export function ProjectDetails({ project, progress, change, flush, entries, saveNote, createTask, deleteProject, active, onNativeMenuChange, onError }: {
  deleteProject(): void;
  createTask(title: string): Promise<boolean>;
  active: boolean; onNativeMenuChange(open: boolean): void;
  entries: TaskLogEntry[]; saveNote(entryId: string, text: string): Promise<void>;
  project: Project; progress: { days: number; done: number }; change(project: Project): void; flush(): void; onError(error: unknown): void;
}) {
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [code, setCode] = useState(project.code);
  const [codeEditing, setCodeEditing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const editor = useRef<TaskDescriptionEditorHandle>(null);
  const log = useRef<TaskLogSectionHandle>(null);
  const [width, setWidth] = useState(560);
  const [logHeight, setLogHeight] = useState(224);
  useEffect(() => {
    if (!active) return;
    return eventBridge.onFileDrop((x, y, paths) => {
      const hit = document.elementFromPoint?.(x, y);
      if (!hit || !panel.current?.contains(hit)) return;
      const target = hit.closest('[data-task-log]') ? log.current : hit.closest('[data-description-editor]') ? editor.current : null;
      if (target) void Promise.resolve().then(() => target.insertFiles(paths, x, y)).catch(onError);
    });
  }, [active, onError]);
  const contextMenu: EditorContextMenuCallback = async (event, context) => {
    const origin = panel.current;
    onNativeMenuChange(true);
    try {
      const id = await eventBridge.showTaskContextMenu(context.items, contextMenuAnchor(event));
      if (origin?.isConnected && !origin.closest('[inert]') && context.items.some(item => item.id === id && !item.disabled)) await context.execute(id);
    } catch (error) { onError(error); }
    finally { onNativeMenuChange(false); }
  };
  return <aside ref={panel} data-project-details tabIndex={-1} aria-label={t('Projekte')}
    style={{ width: 'min(' + width + 'px, max(200px, calc(100vw - 300px)))', '--wails-drop-target': active ? 'drop' : 'none' } as React.CSSProperties}
    onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}
    className="relative flex shrink-0 flex-col gap-3 p-3 border-r bg-white min-h-0">
    <ResizeHandle orientation="vertical" label={t('Breite der Detailansicht ändern')} value={width}
      limits={() => [200, Math.max(200, window.innerWidth - 280)]} onChange={setWidth}/>
    <h2 className="text-xs font-semibold uppercase text-slate-500">{t('Projekte')}</h2>
    <button type="button" className="absolute top-2 right-3 text-xs text-red-700 hover:underline" onClick={deleteProject}>{t('Projekt löschen')}</button>
    <div className="flex items-center gap-2"><input type="color" aria-label={t('Projektfarbe')} value={project.color} onChange={e => change({ ...project, color: e.target.value })}/>
      <input className="w-28 border rounded px-2 font-mono font-semibold" aria-label={t('Projektkürzel')} maxLength={8}
      value={codeEditing ? code : project.code} onFocus={() => { setCodeEditing(true); setCode(project.code); }}
      onChange={e => setCode(e.target.value.toUpperCase())} pattern="[A-Z0-9]{2,8}" onBlur={() => { setCodeEditing(false);
        if (/^[A-Z0-9]{2,8}$/.test(code)) change({ ...project, code }); else setCode(project.code);
      }}/>
      <button type="button" title={t('Neuen Task anlegen')} aria-label={t('Neuen Task anlegen')}
        className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs" onClick={() => setTaskTitle(taskTitle ?? '')}><Plus size={14}/>{t('Neuen Task anlegen')}</button></div>
    {taskTitle !== null && <form className="flex gap-1" onSubmit={async e => {
      e.preventDefault(); if (await createTask(taskTitle)) setTaskTitle(null);
    }}><input autoFocus required className="min-w-0 flex-1 rounded border px-2 text-sm" aria-label={t('Neuen Task anlegen')} value={taskTitle}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setTaskTitle(null); } }}
      onChange={e => setTaskTitle(e.target.value)}/><button type="submit" aria-label={t('Neuen Task anlegen')}><Check size={14}/></button></form>}
    <label className="text-xs text-slate-600">{t('Kurzbeschreibung')}<input className="block border rounded p-1 w-full" value={project.summary}
      onChange={e => change({ ...project, summary: e.target.value })} onBlur={flush}/></label>
    <div className="text-xs text-slate-600">{t('Fortschritt')} · {formatNumber(progress.done)} / {formatNumber(progress.days)} {t('Tage')}<progress className="block w-full" value={progress.done} max={progress.days || 1}/></div>
    <section className="flex flex-col flex-1 min-h-0"><h3 className="text-xs text-slate-600">{t('Beschreibung')}</h3>
      <TaskDescriptionEditor ref={editor} active={active} taskId={project.projectId} description={project.description} onChange={description => change({ ...project, description })}
        onCommit={flush} onEscape={() => panel.current?.focus()} onError={onError} onContextMenu={contextMenu}/>
    </section>
    <ResizeHandle orientation="horizontal" direction={-1} label={t('Höhe des Logs ändern')} value={logHeight}
      limits={() => [100, Math.max(100, (panel.current?.clientHeight ?? 0) - 320)]} onChange={setLogHeight}/>
    <div style={{ height: 'min(' + logHeight + 'px, max(100px, calc(100% - 320px)))' }} className="min-h-0 shrink-0 overflow-hidden border-t"><TaskLogSection ref={log} taskId={project.projectId} entries={entries}
      onAdd={text => saveNote(crypto.randomUUID(), text)} onUpdate={saveNote} onRemove={id => saveNote(id, '')}
      onContextMenu={contextMenu} onError={onError}/></div>
  </aside>;
}

export function DeleteProjectDialog({ code, cancel, confirm }: { code: string; cancel(): void; confirm(): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="delete-project-title" role="alertdialog"
    className="m-auto max-w-md rounded-xl border bg-white p-5 shadow-xl backdrop:bg-slate-900/30"
    onCancel={event => { event.preventDefault(); if (!busy) cancel(); }} onKeyDown={event => event.stopPropagation()}>
    <h2 id="delete-project-title" className="font-semibold">{t('Projekt löschen')}</h2>
    <p className="my-4 text-sm">{t('Projekt {code} und seine Labels an allen Tasks endgültig löschen?', { code })}</p>
    <div className="flex justify-end gap-3">
      <button autoFocus disabled={busy} onClick={cancel}>{t('Abbrechen')}</button>
      <button disabled={busy} className="rounded bg-red-700 px-3 py-1 text-white" onClick={async () => {
        setBusy(true); try { await confirm(); } finally { setBusy(false); }
      }}>{t('Projekt löschen')}</button>
    </div>
  </dialog>;
}
