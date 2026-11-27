import { sourceSymbol } from './editor/SourceIcon';
// All views share these actions; any task can be used as the source of a new task, and title editing stays outside the menu.
import { useContextMenu } from './ContextMenuPopup';
import { useEffect, useRef } from 'react';
import { eventBridge, type TaskMenuItem } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import type { ContextMenuState, MenuRelation } from '../hooks/useTaskSelection';
import { t } from '../i18n';
import { openTarget } from './editor/contextMenu';
import { pathRoot, pathSeparator, tokenizeTargets } from './editor/targets';

interface TaskContextMenuProps {
  contextMenu: ContextMenuState;
  task: TaskState;
  projectDescriptions?: string[];
  databaseKey: string;
  onClose: () => void;
  onToggleActive: (task: TaskState) => void;
  onSetConfiguredDate: (id: string, date: string, label: string) => void;
  onRemovePredecessor: (id: string, predecessor: string) => void;
  onCompleteTask: (id: string) => void;
  onReopenTask: (id: string) => void;
  onCreateSuccessor: (id: string) => void;
  onOpenCopy: (id: string) => void;
  onError: (error: unknown) => void;
}

export type TaskMenuActions = Pick<TaskContextMenuProps, 'onToggleActive' | 'onSetConfiguredDate' | 'onRemovePredecessor' | 'onCompleteTask' | 'onReopenTask' | 'onOpenCopy' | 'onCreateSuccessor'>;

export function executeTaskMenuAction(id: string, task: TaskState, actions: TaskMenuActions, relation?: MenuRelation) {
  if (!taskMenuItems(task, relation).some(item => item.id === id && !item.disabled)) return;
  if (id === 'reopen') actions.onReopenTask(task.id);
  else if (id === 'open-copy') actions.onOpenCopy(task.id);
  else if (id === 'create-successor') actions.onCreateSuccessor(task.id);
  else if (id === 'detach' && relation) {
    if (relation.direction === 'predecessor') actions.onRemovePredecessor(task.id, relation.id);
    else actions.onRemovePredecessor(relation.id, task.id);
  } else if (id === 'toggle') actions.onToggleActive(task);
  else if (id === 'today') actions.onSetConfiguredDate(task.id, new Date().toISOString(), t('Heute'));
  else if (id === 'complete') actions.onCompleteTask(task.id);
  else if (id.startsWith('remove:')) actions.onRemovePredecessor(task.id, id.slice(7));
}

// One menu definition and action path for native and in-app menus in every layout.
export function taskMenuItems(task: TaskState, relation?: MenuRelation): TaskMenuItem[] {
  const openCopy = { id: 'open-copy', label: t('Kopie Öffnen'), disabled: false };
  const successor = { id: 'create-successor', label: t('Nachfolger anlegen'), disabled: false };
  const unlink = relation ? [{ id: 'detach', disabled: false, label: relation.direction === 'predecessor'
    ? t('Vorgänger {id} lösen', { id: relation.id }) : t('Nachfolger {id} lösen', { id: relation.id }) }]
    : task.completed ? [] : task.predecessorIds.map(id => ({ id: 'remove:' + id, label: t('Vorgänger {id} lösen', { id }), disabled: false }));
  if (task.completed) return [
    { id: 'reopen', label: t('Erneut öffnen'), shortcut: 'O', disabled: false },
    openCopy, successor, ...unlink,
  ];
  return [
    { id: 'toggle', label: task.isActive ? t('Deaktivieren') : t('Aktivieren (Hervorheben)'), shortcut: `${t('Space')} / A`, disabled: false },
    { id: 'today', label: t('Startdatum auf Heute setzen'), shortcut: 'T', disabled: false },
    { id: 'complete', label: t('Als erledigt markieren'), shortcut: 'Del / D', disabled: false },
    openCopy, successor, ...unlink,
  ];
}

// Use the editor's path recognition for description and log sources. Only existing
// directories belong here; files and unavailable paths must not block task actions.
export async function taskDirectoryPaths(task: TaskState): Promise<string[]> {
  const candidates = new Set<string>();
  for (const text of [task.description, ...(task.logEntries ?? []).map(entry => entry.text)]) {
    for (const target of tokenizeTargets(text ?? '')) {
      if (target.kind !== 'path') continue;
      const separator = pathSeparator(target.value);
      candidates.add(target.value.endsWith(separator) ? target.value : target.value + separator);
    }
  }
  const paths: string[] = [];
  for (const path of candidates.values()) {
    try {
      if (await eventBridge.getPathKind(path) === 'directory') paths.push(path);
    } catch { /* A missing source does not disable the task menu. */ }
  }
  return paths;
}

export function shortenedDirectoryPath(path: string): string {
  const characters = Array.from(path);
  if (characters.length <= 48) return path;
  // Keep the root and the most useful trailing text.
  const root = pathRoot(path);
  return root + '...' + characters.slice(-Math.max(16, 48 - root.length - 3)).join('');
}

export function directoryMenuItems(paths: string[]): TaskMenuItem[] {
  if (!paths.length) return [];
  return [
    { id: 'directories:separator', label: '', disabled: false, separator: true },
    { id: 'directories:heading', label: t('Im Explorer öffnen'), disabled: true },
    ...paths.map((path, index) => ({ id: `directory:${index}`, label: sourceSymbol({ kind: 'path', value: path }, 'directory') + ' ' + shortenedDirectoryPath(path), disabled: false })),
  ];
}

export async function projectMenuSources(descriptions: readonly string[] = []) {
  const targets = [...new Map(descriptions.flatMap(text => tokenizeTargets(text).map(target => [
    target.value, target,
  ] as const))).values()];
  return {
    items: await Promise.all(targets.map(async (target, index) => {
      const kind = target.kind === 'path' ? await eventBridge.getPathKind(target.value).catch(() => undefined) : undefined;
      return { id: 'project-source:' + index, label: sourceSymbol(target, kind) + ' ' + target.value, disabled: false };
    })),
    target: (id: string) => targets.find((_, index) => id === 'project-source:' + index),
  };
}

export function TaskContextMenu(props: TaskContextMenuProps) {
  const showMenu = useContextMenu();
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    // Defer one microtask so StrictMode's discarded effect never opens a second native popup.
    Promise.resolve().then(async () => {
      if (signal.aborted) return;
      try {
        const [paths, sources] = await Promise.all([taskDirectoryPaths(props.task), projectMenuSources(props.projectDescriptions)]);
        const items = [...taskMenuItems(props.task, props.contextMenu.relation), ...sources.items];
        if (signal.aborted) return;
        const { anchor, x, y } = props.contextMenu;
        const id = await showMenu([...items, ...directoryMenuItems(paths)], { nativeAnchor: anchor, point: anchor ?? { x, y } }, signal);
        if (signal.aborted) return;
        const active = latest.current;
        const source = sources.target(id);
        if (source) { active.onClose(); await openTarget(source).catch(active.onError); return; }
        const directoryIndex = paths.findIndex((_, index) => id === `directory:${index}`);
        if (directoryIndex !== -1) {
          active.onClose();
          try { await eventBridge.openFolderInExplorer(paths[directoryIndex], false); }
          catch (error) { active.onError(error); }
          return;
        }
        const item = taskMenuItems(active.task, active.contextMenu.relation).find(item => item.id === id && !item.disabled);
        active.onClose();
        if (!item || !items.some(item => item.id === id && !item.disabled)) return;
        executeTaskMenuAction(id, active.task, active, active.contextMenu.relation);
      } catch (error) {
        if (!signal.aborted) {
          latest.current.onClose();
          latest.current.onError(error);
        }
      }
    });
    return () => abort.abort();
  }, [props.contextMenu, props.databaseKey, showMenu]);
  return null;
}
