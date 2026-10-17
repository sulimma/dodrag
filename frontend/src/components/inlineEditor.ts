import type { TaskState } from '../domain/types';

export interface InlineEditor {
  taskId: string | null;
  value: string;
  onChange: (value: string) => void;
  onStart: (task: TaskState) => void;
  onCommit: () => void;
  onCancel: () => void;
}
