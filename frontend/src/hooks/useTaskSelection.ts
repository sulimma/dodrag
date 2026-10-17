import { useEffect, useState } from 'react';
import { ModifierKeys } from '../components/taskInteractions';
export interface ContextMenuState {
  x: number;
  y: number;
  taskId: string;
}
export function useTaskSelection() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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
  const onSelectTask = (id: string) => {
    clearEdgeSelection();
    setSelectedTaskId((previous) => (previous === id ? null : id));
  };
  const onContextMenuTask = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    clearEdgeSelection();
    setSelectedTaskId(id);
    setContextMenu({ x: event.clientX, y: event.clientY, taskId: id });
  };
  const reset = () => {
    setSelectedTaskId(null);
    clearEdgeSelection();
    setContextMenu(null);
  };
  return {
    selectedTaskId,
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
