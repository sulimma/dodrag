import { useEffect, useMemo, useRef, useState } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import { projectCatalog, type Project } from '../domain/projects';
import type { useDatabaseSnapshot } from './useDatabaseSnapshot';
import type { EventCommand } from '../domain/eventSchema';

export function useProjects(database: ReturnType<typeof useDatabaseSnapshot>) {
  const catalog = useMemo(() => projectCatalog(database.events), [database.events]);
  const drafts = useRef(new Map<string, Project>());
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [, redraw] = useState(0);
  type Label = { taskId: string; projectId: string };
  const [selectedLabels, setSelectedLabels] = useState<Label[]>([]);
  function selectLabel(taskId: string, projectId: string, additive: boolean) {
    const label = { taskId, projectId };
    setSelectedLabels(previous => {
      if (!additive) return [label];
      const rest = previous.filter(p => p.taskId !== taskId || p.projectId !== projectId);
      return rest.length === previous.length ? [...rest, label] : rest;
    });
  }
  function remove(taskId: string, projectId: string) {
    const targets = selectedLabels.some(p => p.taskId === taskId && p.projectId === projectId) ? selectedLabels : [{ taskId, projectId }];
    void database.mutate(() => eventBridge.appendBatch(targets.map(label => ({ type: 'PROJECT_MEMBER_SET', payload: { ...label, assigned: false } }))));
    setSelectedLabels([]);
  }
  const orderKey = 'dodrag-project-order:' + (database.appSettings?.activeDatabasePath ?? '');
  const [sessionOrder, setSessionOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const orderedIds = useMemo(() => {
    let stored: unknown;
    if (sessionOrder?.key === orderKey) stored = sessionOrder.ids;
    else try { stored = JSON.parse(window.localStorage?.getItem(orderKey) ?? '[]'); } catch { stored = []; }
    const saved = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && catalog.projects.has(id)) : [];
    return [...new Set([...saved, ...catalog.projects.keys()])];
  }, [orderKey, catalog.projects, sessionOrder]);
  function reorder(id: string, before: string | null) {
    if (before === id || !orderedIds.includes(id)) return;
    const next = orderedIds.filter(value => value !== id);
    const at = before === null ? next.length : next.indexOf(before);
    if (at < 0) return;
    next.splice(at, 0, id);
    if (next.every((value, index) => value === orderedIds[index])) return;
    setSessionOrder({ key: orderKey, ids: next });
    try { window.localStorage?.setItem(orderKey, JSON.stringify(next)); } catch { /* Keep the session order when browser storage is unavailable. */ }
  }
  const anchor = useRef<string | null>(null);
  function selectProject(id: string, modifiers?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    const additive = modifiers?.ctrlKey || modifiers?.metaKey;
    const start = anchor.current ? orderedIds.indexOf(anchor.current) : -1;
    if (modifiers?.shiftKey && start >= 0) {
      const end = orderedIds.indexOf(id);
      const range = orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      setSelected(previous => additive ? [...new Set([...previous, ...range])] : range);
    } else {
      anchor.current = id;
      setSelected(previous => {
        const current = previous.filter(value => catalog.projects.has(value));
        if (additive) return current.includes(id) ? current.filter(value => value !== id) : [...current, id];
        // An explicit menu command always selects its project. Only a plain click toggles a sole selection.
        if (modifiers && !modifiers.shiftKey && current.length === 1 && current[0] === id) return [];
        return [id];
      });
    }
  }
  function clearProjects() { anchor.current = null; setSelected([]); }
  const [selected, setSelected] = useState<string[]>([]);
  const selectedIds = useMemo(() => selected.filter(id => catalog.projects.has(id)), [selected, catalog]);

  function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    if (pending.current) return pending.current;
    if (!drafts.current.size) return Promise.resolve(true);
    const run = async () => {
      while (drafts.current.size) {
        const entries = [...drafts.current.values()];
        const result = await database.mutate(() => eventBridge.appendBatch(entries.map(payload => ({ type: 'PROJECT_SAVED', payload }))));
        if (!result) return false;
        for (const p of entries) if (drafts.current.get(p.projectId) === p) drafts.current.delete(p.projectId);
      }
      return true;
    };
    pending.current = run().finally(() => { pending.current = null; redraw(n => n + 1); });
    return pending.current;
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  function change(project: Project) {
    drafts.current.set(project.projectId, project);
    redraw(n => n + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 450);
  }
  async function create(code: string) {
    const projectId = crypto.randomUUID();
    const colors = ['#0369a1', '#047857', '#9333ea', '#be123c', '#b45309', '#4338ca'];
    const color = colors[catalog.projects.size] ?? '#' + projectId.replace(/-/g, '').slice(0, 6);
    const result = await database.mutate(() => eventBridge.appendEvent('PROJECT_SAVED', { projectId, code, color, description: '', summary: '' }));
    if (result) selectProject(projectId);
    return result ? projectId : null;
  }
  function assign(taskIds: string[], projectIds: string[]) {
    if (!taskIds.length || !projectIds.length) return;
    void database.mutate(() => {
      const current = projectCatalog(database.confirmedEvents.current);
      const commands: EventCommand[] = [];
      for (const projectId of projectIds) {
        if (!current.projects.has(projectId)) continue;
        for (const taskId of taskIds) {
          if (!current.members.get(taskId)?.has(projectId)) {
            commands.push({ type: 'PROJECT_MEMBER_SET', payload: { taskId, projectId, assigned: true } });
          }
        }
      }
      return commands.length ? eventBridge.appendBatch(commands) : Promise.resolve(database.confirmedEvents.current);
    });
  }
  return { ...catalog, orderedIds, reorder, selectProject, clearProjects, selectedLabels, selectLabel, setSelectedLabels, remove, selectedIds, setSelected, create, assign, flush, change, drafts,
    hasPending: () => !!pending.current || !!drafts.current.size,
    reset: () => { clearTimeout(timer.current); drafts.current.clear(); clearProjects(); setSelectedLabels([]); } };
}
