import React from 'react';
import { HighlightRole, TaskState } from '../domain/types';

export interface ModifierKeys {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface TaskInteractions {
  onSelectTask: (id: string) => void;
  onDragStartTask: (event: React.DragEvent, id: string) => void;
  onDragEndTask: () => void;
  onShiftKeyChange: (shift: boolean) => void;
  isShiftDrag: boolean;
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
export function taskInteractions(
  id: string,
  key: string,
  actions: TaskInteractions
) {
  return {
    draggable: true,
    'data-task-drag': id,
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => {
      if (
        event.shiftKey &&
        !(event.target as HTMLElement).closest(
          'input,textarea,button,[contenteditable="true"]'
        )
      ) {
        // Suppress Shift's native selection extension, not mousedown's native drag default.
        event.currentTarget.setAttribute('data-shift-drag', 'true');
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) =>
      event.currentTarget.removeAttribute('data-shift-drag'),
    onMouseDown: undefined,
    onDragStart: (event: React.DragEvent) => actions.onDragStartTask(event, id),
    onDragEnd: (event: React.DragEvent<HTMLElement>) => {
      event.currentTarget.removeAttribute('data-shift-drag');
      actions.onDragEndTask();
    },
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!(event.target as HTMLElement).closest('input,button,textarea'))
        actions.onSelectTask(id);
    },
    onContextMenu: (event: React.MouseEvent) =>
      actions.onContextMenuTask(event, id),
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      actions.onShiftKeyChange(event.shiftKey);
      if (actions.draggedTaskId && actions.draggedTaskId !== id) {
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
      if (source && source !== id) {
        if (event.shiftKey) actions.onRemoveDependencyBetween(source, id);
        else actions.onAddPredecessor(source, id);
      }
      actions.onDragEndTask();
    },
  };
}
