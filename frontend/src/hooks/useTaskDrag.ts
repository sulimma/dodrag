import React, { useEffect, useState } from 'react';
import type { TaskState } from '../domain/types';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskSelection } from './useTaskSelection';
import { taskDragPreview } from './taskDragPreview';
import { installTaskPointerDrag } from './taskPointerDrag';
export interface DragIdentity {
  database: string;
  taskId: string;
  taskIds: string[];
}
// Owns frozen task-drag identity, preview resources and React target state.
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
  const [isAltDrag, setIsAltDrag] = useState<boolean>(false);
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
    previewCleanup.current = taskDragPreview(e.dataTransfer, e.currentTarget as HTMLElement, taskIds, tasks, e.clientX, e.clientY, true);
    if (!selectedTaskIds.includes(taskId)) setSelectedTaskId(taskId);
    clearEdgeSelection();
  };

  const endDrag = () => {
    previewCleanup.current?.();
    previewCleanup.current = null;
    dragIdentity.current = null;
    setDraggedTaskId(null);
    setIsAltDrag(false);
    setActiveDropTargetKey(null);
  };

  // Callbacks only use stable setters and refs; DOM drag handlers use current renders.
  useEffect(() => installTaskPointerDrag(endDrag, setIsAltDrag), [dragIdentity]);
  return {
    draggedTaskId,
    isAltDrag,
    activeDropTargetKey,
    setActiveDropTargetKey,
    onDragStartTask,
  };
}
