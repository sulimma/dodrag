import type { TaskState } from '../domain/types';
import type React from 'react';

export interface InlineEditor {
  taskId: string | null;
  value: string;
  onChange: (value: string) => void;
  onStart: (task: TaskState) => void;
  onCommit: () => void;
  onCancel: () => void;
}

// One keyboard/blur contract for task titles and log text, including IME input.
export function inlineTextHandlers(onCommit: () => void, onCancel: () => void) {
  let cancelled = false;
  return {
    onBlur: () => { if (!cancelled) onCommit(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onCommit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled = true; onCancel(); }
    },
  };
}
