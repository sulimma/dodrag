import { selectionActionIds } from '../domain/selection';
import React, { useCallback, useEffect, useState } from 'react';
import type { TaskState } from '../domain/types';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskSelection } from './useTaskSelection';
import { taskDragPreview } from './taskDragPreview';
import { installTaskPointerDrag } from './taskPointerDrag';
export interface MarkerDrag { dateKey: string; markerId?: string }
export interface DragIdentity {
  marker?: MarkerDrag;
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
  const [draggedMarker, setDraggedMarker] = useState<MarkerDrag | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [isAltDrag, setIsAltDrag] = useState<boolean>(false);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(
    null
  );
  const onDragStartTask = (e: React.DragEvent, taskId: string, keepDetailTask = false) => {
    if (mutationBusy.current || !snapshotConfirmed.current || !tasks[taskId]) {
      e.preventDefault();
      return;
    }
    const taskIds = tasks[taskId].completed
      ? [taskId]
      : selectionActionIds(taskId, selectedTaskIds).filter(id => tasks[id] && !tasks[id].completed);
    dragIdentity.current = { database: databaseIdentity.current, taskId, taskIds };
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'all';
    previewCleanup.current?.();
    previewCleanup.current = taskDragPreview(e.dataTransfer, e.currentTarget as HTMLElement, taskIds, tasks, e.clientX, e.clientY, true);
    if (!keepDetailTask && !tasks[taskId].completed && !selectedTaskIds.includes(taskId)) setSelectedTaskId(taskId);
    clearEdgeSelection();
  };

  const onDragStartMarker = (event: React.DragEvent, marker: MarkerDrag) => {
    if (mutationBusy.current || !snapshotConfirmed.current) { event.preventDefault(); return; }
    dragIdentity.current = { database: databaseIdentity.current, taskId: '', taskIds: [], marker };
    setDraggedMarker(marker);
    event.dataTransfer.setData('application/x-dodrag-marker', marker.markerId ?? marker.dateKey);
    event.dataTransfer.effectAllowed = 'all';
    previewCleanup.current?.();
    const source = event.currentTarget as HTMLElement;
    previewCleanup.current = taskDragPreview(event.dataTransfer, source, [source.dataset.taskDrag!], {}, event.clientX, event.clientY, true);
  };

  // Setters only read refs when invoked; keeping the installer stable avoids
  // reinstalling window listeners on renders that happen during a gesture.
  const endDrag = useCallback(() => {
    previewCleanup.current?.();
    previewCleanup.current = null;
    dragIdentity.current = null;
    setDraggedTaskId(null);
    setDraggedMarker(null);
    setIsAltDrag(false);
    setActiveDropTargetKey(null);
  }, [dragIdentity]);

  useEffect(() => installTaskPointerDrag(endDrag, setIsAltDrag), [endDrag]);
  return {
    draggedMarker,
    onDragStartMarker,
    draggedTaskId,
    isAltDrag,
    activeDropTargetKey,
    setActiveDropTargetKey,
    onDragStartTask,
  };
}
