import { useEffect, useState } from 'react';
import type { ModifierKeys } from '../components/taskInteractions';
export interface ContextMenuState {
  x: number;
  y: number;
  taskId: string;
}
// Owns selected tasks, selected edges, and the active task context menu.
export function useTaskSelection() {
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const selectedTaskId = selectedTaskIds.at(-1) ?? null;
  const [lastClickedTaskId, setLastClickedTaskId] = useState<string | null>(null);
  const setSelectedTaskId = (id: string | null) => {
    setSelectedTaskIds(id ? [id] : []);
    setLastClickedTaskId(id);
  };
  const [selectedEdgeKeys, setSelectedEdgeKeys] = useState<string[]>([]);
  const [lastClickedEdgeKey, setLastClickedEdgeKey] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const clearEdgeSelection = () => {
    setSelectedEdgeKeys([]);
    setLastClickedEdgeKey(null);
  };

  const onSelectEdge = (
    edgeKey: string,
    e: ModifierKeys,
    orderedEdgeKeys: string[]
  ) => {
    setSelectedTaskId(null);
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (
      isShift &&
      lastClickedEdgeKey &&
      orderedEdgeKeys.includes(lastClickedEdgeKey) &&
      orderedEdgeKeys.includes(edgeKey)
    ) {
      const idxA = orderedEdgeKeys.indexOf(lastClickedEdgeKey);
      const idxB = orderedEdgeKeys.indexOf(edgeKey);
      const start = Math.min(idxA, idxB);
      const end = Math.max(idxA, idxB);
      const rangeKeys = orderedEdgeKeys.slice(start, end + 1);
      if (isCtrl) {
        setSelectedEdgeKeys((prev) =>
          Array.from(new Set([...prev, ...rangeKeys]))
        );
      } else {
        setSelectedEdgeKeys(rangeKeys);
      }
      return;
    }

    if (isCtrl) {
      setSelectedEdgeKeys((prev) =>
        prev.includes(edgeKey)
          ? prev.filter((k) => k !== edgeKey)
          : [...prev, edgeKey]
      );
      setLastClickedEdgeKey(edgeKey);
      return;
    }

    setSelectedEdgeKeys((prev) => {
      if (prev.length === 1 && prev[0] === edgeKey) {
        setLastClickedEdgeKey(null);
        return [];
      }
      setLastClickedEdgeKey(edgeKey);
      return [edgeKey];
    });
  };
  // Close context menu on outside click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);
  const onSelectTask = (
    id: string,
    event: ModifierKeys = { ctrlKey: false, metaKey: false, shiftKey: false },
    orderedIds: string[] = [id]
  ) => {
    clearEdgeSelection();
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey && lastClickedTaskId && orderedIds.includes(lastClickedTaskId) && orderedIds.includes(id)) {
      const a = orderedIds.indexOf(lastClickedTaskId);
      const b = orderedIds.indexOf(id);
      const range = orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelectedTaskIds(previous => additive ? Array.from(new Set([...previous, ...range])) : range);
      return;
    }
    setSelectedTaskIds(previous => additive
      ? previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]
      : previous.length === 1 && previous[0] === id ? [] : [id]);
    setLastClickedTaskId(id);
  };
  const onContextMenuTask = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    clearEdgeSelection();
    if (!selectedTaskIds.includes(id)) setSelectedTaskId(id);
    setContextMenu({ x: event.clientX, y: event.clientY, taskId: id });
  };
  const reset = () => {
    setSelectedTaskId(null);
    clearEdgeSelection();
    setContextMenu(null);
  };
  return {
    selectedTaskId,
    selectedTaskIds,
    setSelectedTaskIds,
    setSelectedTaskId,
    selectedEdgeKeys,
    clearEdgeSelection,
    onSelectEdge,
    contextMenu,
    setContextMenu,
    onSelectTask,
    onContextMenuTask,
    reset,
  };
}
