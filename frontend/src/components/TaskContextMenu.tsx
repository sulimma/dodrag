import { useEffect, useRef } from 'react';
import { eventBridge, type TaskMenuItem } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import type { ContextMenuState } from '../hooks/useTaskSelection';
import { t } from '../i18n';

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
        const id = await eventBridge.showTaskContextMenu(items);
        if (!current) return;
        const active = latest.current;
        const item = taskMenuItems(active.task).find(item => item.id === id && !item.disabled);
        active.onClose();
        if (!item || !items.some(item => item.id === id && !item.disabled)) return;
        if (id === 'reopen') active.onReopenTask(active.task.id);
        else if (id === 'toggle') active.onToggleActive(active.task);
        else if (id === 'today') active.onSetConfiguredDate(active.task.id, new Date().toISOString(), t('Heute'));
        else if (id === 'complete') active.onCompleteTask(active.task.id);
        else if (id.startsWith('remove:')) active.onRemovePredecessor(active.task.id, id.slice(7));
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
