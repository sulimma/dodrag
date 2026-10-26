import { useEffect, useRef } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import { fileDropText, parseSourcePayload, SOURCE_MIME } from '../components/editor/targets';
import type { EditorTarget } from '../components/editor/types';

export function sourceDropTask(element: EventTarget | null): string | undefined {
  if (!(element instanceof Element) || element.closest('[data-description-editor], [data-task-log]')) return;
  return element.closest<HTMLElement>('[data-source-task-id]')?.dataset.sourceTaskId;
}

export function useSourceDrop(onDrop: (taskId: string, sources: EditorTarget[]) => Promise<void>, onError: (error: unknown) => void) {
  const latest = useRef({ onDrop, onError }); latest.current = { onDrop, onError };
  useEffect(() => {
    const native = eventBridge.onFileDrop((x, y, paths) => {
      const taskId = sourceDropTask(document.elementFromPoint(x, y));
      if (!taskId || !paths.length) return;
      try {
        fileDropText(paths);
        void latest.current.onDrop(taskId, paths.map(value => ({ kind: 'path', value }))).catch(latest.current.onError);
      } catch (error) { latest.current.onError(error); }
    });
    const dragOver = (event: DragEvent) => {
      if (!sourceDropTask(event.target) || !event.dataTransfer?.types?.includes(SOURCE_MIME)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    };
    const drop = (event: DragEvent) => {
      const taskId = sourceDropTask(event.target);
      if (!taskId || !event.dataTransfer?.types?.includes(SOURCE_MIME)) return;
      event.preventDefault(); event.stopPropagation();
      const source = parseSourcePayload(event.dataTransfer.getData(SOURCE_MIME));
      if (source) void latest.current.onDrop(taskId, [source]).catch(latest.current.onError);
    };
    window.addEventListener('dragover', dragOver, true);
    window.addEventListener('drop', drop, true);
    return () => { native(); window.removeEventListener('dragover', dragOver, true); window.removeEventListener('drop', drop, true); };
  }, []);
}
