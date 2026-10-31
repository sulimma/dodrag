// Product rule: native Windows popups extend beyond the mini window. All views share these actions; completed tasks offer only reopen as a mutation, and title editing stays outside the menu.
import { useEffect, useRef } from 'react';
import { eventBridge, type TaskMenuItem } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import type { ContextMenuState } from '../hooks/useTaskSelection';
import { t } from '../i18n';
import { tokenizeTargets } from './editor/targets';

interface TaskContextMenuProps {
  contextMenu: ContextMenuState;
  task: TaskState;
  databaseKey: string;
  onClose: () => void;
  onToggleActive: (task: TaskState) => void;
  onSetConfiguredDate: (id: string, date: string, label: string) => void;
  onRemovePredecessor: (id: string, predecessor: string) => void;
  onCompleteTask: (id: string) => void;
  onReopenTask: (id: string) => void;
  onError: (error: unknown) => void;
}

export type TaskMenuActions = Pick<TaskContextMenuProps, 'onToggleActive' | 'onSetConfiguredDate' | 'onRemovePredecessor' | 'onCompleteTask' | 'onReopenTask'>;

export function executeTaskMenuAction(id: string, task: TaskState, actions: TaskMenuActions) {
  if (!taskMenuItems(task).some(item => item.id === id && !item.disabled)) return;
  if (id === 'reopen') actions.onReopenTask(task.id);
  else if (id === 'toggle') actions.onToggleActive(task);
  else if (id === 'today') actions.onSetConfiguredDate(task.id, new Date().toISOString(), t('Heute'));
  else if (id === 'complete') actions.onCompleteTask(task.id);
  else if (id.startsWith('remove:')) actions.onRemovePredecessor(task.id, id.slice(7));
}

// One menu definition and action path for every layout; Windows owns placement and keyboard input.
export function taskMenuItems(task: TaskState): TaskMenuItem[] {
  if (task.completed) return [{ id: 'reopen', label: t('Erneut öffnen'), shortcut: 'O', disabled: false }];
  return [
    { id: 'toggle', label: task.isActive ? t('Deaktivieren') : t('Aktivieren (Hervorheben)'), shortcut: `${t('Space')} / A`, disabled: false },
    { id: 'today', label: t('Startdatum auf Heute setzen'), shortcut: 'T', disabled: false },
    { id: 'complete', label: t('Als erledigt markieren'), shortcut: 'Del / D', disabled: false },
    ...task.predecessorIds.map(id => ({ id: `remove:${id}`, label: t('Vorgänger {id} lösen', { id }), disabled: false })),
  ];
}

// Use the editor's path recognition for description and log sources. Only existing
// directories belong here; files and unavailable paths must not block task actions.
export async function taskDirectoryPaths(task: TaskState): Promise<string[]> {
  const candidates = new Map<string, string>();
  for (const text of [task.description, ...(task.logEntries ?? []).map(entry => entry.text)]) {
    for (const target of tokenizeTargets(text ?? '')) {
      if (target.kind !== 'path') continue;
      const path = target.value.replace(/\\+$/, '') + '\\';
      const key = path.toLowerCase();
      if (!candidates.has(key)) candidates.set(key, path);
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
  // Keep the drive root (or UNC server/share) and the most useful trailing text.
  const root = path.match(/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i)?.[0] ?? '';
  return root + '...' + characters.slice(-Math.max(16, 48 - root.length - 3)).join('');
}

export function directoryMenuItems(paths: string[]): TaskMenuItem[] {
  if (!paths.length) return [];
  return [
    { id: 'directories:separator', label: '', disabled: false, separator: true },
    { id: 'directories:heading', label: t('Im Explorer öffnen'), disabled: true },
    ...paths.map((path, index) => ({ id: `directory:${index}`, label: shortenedDirectoryPath(path), disabled: false })),
  ];
}

export function TaskContextMenu(props: TaskContextMenuProps) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let current = true;
    const items = taskMenuItems(props.task);
    // Defer one microtask so StrictMode's discarded effect never opens a second native popup.
    Promise.resolve().then(async () => {
      if (!current) return;
      try {
        const paths = await taskDirectoryPaths(props.task);
        if (!current) return;
        const id = await eventBridge.showTaskContextMenu([...items, ...directoryMenuItems(paths)], props.contextMenu.anchor);
        if (!current) return;
        const active = latest.current;
        const directoryIndex = paths.findIndex((_, index) => id === `directory:${index}`);
        if (directoryIndex !== -1) {
          active.onClose();
          try { await eventBridge.openFolderInExplorer(paths[directoryIndex], false); }
          catch (error) { active.onError(error); }
          return;
        }
        const item = taskMenuItems(active.task).find(item => item.id === id && !item.disabled);
        active.onClose();
        if (!item || !items.some(item => item.id === id && !item.disabled)) return;
        executeTaskMenuAction(id, active.task, active);
      } catch (error) {
        if (current) {
          latest.current.onClose();
          latest.current.onError(error);
        }
      }
    });
    return () => { current = false; };
  }, [props.contextMenu, props.databaseKey]);
  return null;
}
