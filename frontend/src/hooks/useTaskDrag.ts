import React, { useEffect, useState } from 'react';
import { TaskState } from '../domain/types';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskSelection } from './useTaskSelection';
export interface DragIdentity {
  database: string;
  taskId: string;
}
export function useTaskDrag(
  database: Pick<
    ReturnType<typeof useDatabaseSnapshot>,
    'mutationBusy' | 'snapshotConfirmed' | 'databaseIdentity'
  >,
  selection: Pick<
    ReturnType<typeof useTaskSelection>,
    'selectedTaskId' | 'setSelectedTaskId' | 'clearEdgeSelection'
  >,
  tasks: Record<string, TaskState>,
  dragIdentity: React.MutableRefObject<DragIdentity | null>
) {
  const { mutationBusy, snapshotConfirmed, databaseIdentity } = database;
  const { selectedTaskId, setSelectedTaskId, clearEdgeSelection } = selection;
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
    dragIdentity.current = { database: databaseIdentity.current, taskId };
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'all';
    if (e.shiftKey) {
      setIsShiftDrag(true);
      setSelectedTaskId(taskId);
      clearEdgeSelection();
    } else {
      setIsShiftDrag(false);
    }
  };

  const onDragEndTask = () => {
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
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('dragend', stop);
    };
  }, []);
  const onShiftKeyChange = (shift: boolean) => {
    setIsShiftDrag(shift);
    if (shift && draggedTaskId && selectedTaskId !== draggedTaskId) {
      setSelectedTaskId(draggedTaskId);
      clearEdgeSelection();
    }
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
