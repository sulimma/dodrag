import React from 'react';
import type { HighlightRole, TaskState } from '../domain/types';

export interface ModifierKeys {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface TaskDragDropActions {
  onDragStartTask: (event: React.DragEvent, id: string) => void;
  draggedTaskId: string | null;
  setActiveDropTargetKey: (key: string | null) => void;
  onAddPredecessor: (source: string, target: string) => void;
  onRemoveDependencyBetween: (source: string, target: string) => void;
}

export interface TaskInteractions extends TaskDragDropActions {
  onSelectTask: (id: string, event: ModifierKeys, orderedIds: string[]) => void;
  selectedTaskIds?: string[];
  orderedTaskIds?: string[];
  isAltDrag: boolean;
  onContextMenuTask: (event: React.MouseEvent, id: string) => void;
}
export interface TaskViewInteractions extends TaskInteractions {
  selectedTaskId: string | null;
  selectedEdgeKeys: string[];
  activeDropTargetKey: string | null;
  highlights: Record<string, HighlightRole>;
  deletionPreview: string[];
  onSelectEdge: (
    key: string,
    event: ModifierKeys,
    orderedKeys: string[]
  ) => void;
  onClearEdgeSelection: () => void;
  onClearTaskSelection: () => void;
  onSetConfiguredDate: (id: string, date: string, label: string) => void;
  onToggleActive: (task: TaskState) => void;
}
// Frozen pointer-drag id first; the transfer value only survives local drags.
export function draggedTaskIdOf(
  event: Pick<React.DragEvent, 'dataTransfer'>,
  draggedTaskId: string | null
) {
  if (event.dataTransfer?.types?.includes('Files') || event.dataTransfer?.types?.includes('application/x-dodrag-source')) return null;
  return draggedTaskId || event.dataTransfer?.getData('text/plain') || null;
}
// Pointer drag origins are shared by full rows and the compact completed rows.
export function taskDragSourceInteractions(
  id: string,
  actions: Pick<TaskDragDropActions, 'onDragStartTask'>
) {
  return {
    draggable: false,
    'data-task-drag': id,
    onDragStart: (event: React.DragEvent) => actions.onDragStartTask(event, id),
  };
}

// Drag/drop handlers shared by full task rows.
export function taskDragDropInteractions(
  id: string,
  key: string,
  actions: TaskDragDropActions
) {
  return {
    ...taskDragSourceInteractions(id, actions),
    ...taskDropTargetInteractions(id, key, actions),
  };
}

export function taskDropTargetInteractions(id: string, key: string, actions: TaskDragDropActions) {
  return {
    'data-task-drop-target': key,
    'data-source-task-id': id,
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer?.types?.includes('Files')) return;
      event.stopPropagation();
      if (actions.draggedTaskId) {
        event.dataTransfer.dropEffect = 'move';
        actions.setActiveDropTargetKey(key);
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        actions.setActiveDropTargetKey(null);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer?.types?.includes('Files')) return;
      event.stopPropagation();
      const source = draggedTaskIdOf(event, actions.draggedTaskId);
      // A self drop still applies the frozen group; the mutation layer omits the self edge.
      if (source) {
        if (event.altKey) actions.onRemoveDependencyBetween(source, id);
        else actions.onAddPredecessor(source, id);
      }
    },
  };
}

// Builds the common task DOM handlers shared by all task views.
export function taskInteractions(
  id: string,
  key: string,
  actions: TaskInteractions
) {
  return {
    ...taskDragDropInteractions(id, key, actions),
    'data-task-selected': actions.selectedTaskIds?.includes(id) || undefined,
    onMouseDown: undefined,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!(event.target as HTMLElement).closest('input,button,textarea'))
        actions.onSelectTask(id, event, actions.orderedTaskIds ?? [id]);
    },
    onContextMenu: (event: React.MouseEvent) =>
      actions.onContextMenuTask(event, id),
  };
}
