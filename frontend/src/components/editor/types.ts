import type React from 'react';
import type { TaskMenuItem } from '../../bridge/eventBridge';

export interface EditorTarget { kind: 'url' | 'path'; value: string }
export interface EditorContextMenu {
  target?: EditorTarget;
  items: TaskMenuItem[];
  execute(action: string): Promise<void>;
}
export type EditorContextMenuCallback = (event: React.MouseEvent, context: EditorContextMenu) => void;
export interface TaskDescriptionEditorHandle {
  insertFiles(paths: readonly string[], x?: number, y?: number): void;
  focus(): void;
}
export type TaskLogSectionHandle = TaskDescriptionEditorHandle;
