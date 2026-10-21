import React from 'react';
import type { HighlightRole, TaskState } from '../domain/types';

export interface ModifierKeys {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface TaskInteractions {
  onSelectTask: (id: string, event: ModifierKeys, orderedIds: string[]) => void;
  selectedTaskIds?: string[];
  orderedTaskIds?: string[];
  onDragStartTask: (event: React.DragEvent, id: string) => void;
  onDragEndTask: () => void;
  onAltKeyChange: (shift: boolean) => void;
  isAltDrag: boolean;
  draggedTaskId: string | null;
  setDraggedTaskId: (id: string | null) => void;
  setActiveDropTargetKey: (key: string | null) => void;
  onAddPredecessor: (source: string, target: string) => void;
  onRemoveDependencyBetween: (source: string, target: string) => void;
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
// Builds the common task DOM handlers shared by all task views.
export function taskInteractions(
  id: string,
  key: string,
  actions: TaskInteractions
) {
  return {
    draggable: false,
    'data-task-drag': id,
    'data-task-drop-target': key,
    'data-task-selected': actions.selectedTaskIds?.includes(id) || undefined,
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (
        event.altKey &&
        !(event.target as HTMLElement).closest(
          'input,textarea,button,[contenteditable="true"]'
        )
      ) {
        // Keep the deletion-mode marker separate from Shift selection/scrolling.
        event.currentTarget.setAttribute('data-alt-drag', 'true');
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) =>
      event.currentTarget.removeAttribute('data-alt-drag'),
    onMouseDown: undefined,
    onDragStart: (event: React.DragEvent) => actions.onDragStartTask(event, id),
    onDragEnd: (event: React.DragEvent<HTMLElement>) => {
      event.currentTarget.removeAttribute('data-alt-drag');
      actions.onDragEndTask();
    },
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!(event.target as HTMLElement).closest('input,button,textarea'))
        actions.onSelectTask(id, event, actions.orderedTaskIds ?? [id]);
    },
    onContextMenu: (event: React.MouseEvent) =>
      actions.onContextMenuTask(event, id),
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      actions.onAltKeyChange(event.altKey);
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
      event.stopPropagation();
      const source =
        actions.draggedTaskId || event.dataTransfer.getData('text/plain');
      if (source) {
        if (event.altKey) actions.onRemoveDependencyBetween(source, id);
        else actions.onAddPredecessor(source, id);
      }
      actions.onDragEndTask();
    },
  };
}
