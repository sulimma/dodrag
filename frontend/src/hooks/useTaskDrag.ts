import React, { useEffect, useState } from 'react';
import type { TaskState } from '../domain/types';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskSelection } from './useTaskSelection';
import { taskDragPreview } from './taskDragPreview';
import { scrollTaskDragWheel } from './taskDragWheel';
export interface DragIdentity {
  database: string;
  taskId: string;
  taskIds: string[];
}
// Owns task-drag state and guards native drags against pending mutations.
export function useTaskDrag(
  database: Pick<
    ReturnType<typeof useDatabaseSnapshot>,
    'mutationBusy' | 'snapshotConfirmed' | 'databaseIdentity'
  >,
  selection: Pick<
    ReturnType<typeof useTaskSelection>,
    'selectedTaskIds' | 'setSelectedTaskId' | 'clearEdgeSelection'
  >,
  tasks: Record<string, TaskState>,
  dragIdentity: React.MutableRefObject<DragIdentity | null>
) {
  const { mutationBusy, snapshotConfirmed, databaseIdentity } = database;
  const { selectedTaskIds, setSelectedTaskId, clearEdgeSelection } = selection;
  const previewCleanup = React.useRef<(() => void) | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [isShiftDrag, setIsShiftDrag] = useState<boolean>(false);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(
    null
  );
  const onDragStartTask = (e: React.DragEvent, taskId: string) => {
    if (mutationBusy.current || !snapshotConfirmed.current || !tasks[taskId]) {
      e.preventDefault();
      return;
    }
    const taskIds = selectedTaskIds.includes(taskId)
      ? selectedTaskIds.filter(id => tasks[id] && !tasks[id].completed)
      : [taskId];
    dragIdentity.current = { database: databaseIdentity.current, taskId, taskIds };
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'all';
    previewCleanup.current?.();
    previewCleanup.current = taskDragPreview(e.dataTransfer, e.currentTarget as HTMLElement, taskIds, tasks, e.clientX, e.clientY);
    if (!selectedTaskIds.includes(taskId)) setSelectedTaskId(taskId);
    clearEdgeSelection();
    setIsShiftDrag(e.shiftKey);
  };

  const onDragEndTask = () => {
    previewCleanup.current?.();
    previewCleanup.current = null;
    dragIdentity.current = null;
    document
      .querySelectorAll('[data-shift-drag]')
      .forEach((element) => element.removeAttribute('data-shift-drag'));
    setDraggedTaskId(null);
    setIsShiftDrag(false);
    setActiveDropTargetKey(null);
  };

  useEffect(() => {
    const stop = () => onDragEndTask();
    const unsubscribeWheel = window.runtime?.EventsOn?.('task:drag-wheel', (event) => {
      if (dragIdentity.current && event && typeof event.horizontal === 'boolean') {
        scrollTaskDragWheel(event);
        setActiveDropTargetKey(null);
      }
    });
    const drop = () => { previewCleanup.current?.(); previewCleanup.current = null; };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop();
      if (event.key === 'Shift') {
        const held = event.type === 'keydown';
        setIsShiftDrag(held);
        document.querySelectorAll('[data-task-drag]').forEach((element) => {
          if (held) element.setAttribute('data-shift-drag', 'true');
          else element.removeAttribute('data-shift-drag');
        });
      }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('keyup', key, true);
    window.addEventListener('blur', stop);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', drop, true);
    return () => {
      drop();
      unsubscribeWheel?.();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', drop, true);
    };
  }, []);
  const onShiftKeyChange = (shift: boolean) => {
    setIsShiftDrag(shift);
  };
  return {
    draggedTaskId,
    setDraggedTaskId,
    isShiftDrag,
    setIsShiftDrag,
    activeDropTargetKey,
    setActiveDropTargetKey,
    onDragStartTask,
    onDragEndTask,
    onShiftKeyChange,
  };
}
