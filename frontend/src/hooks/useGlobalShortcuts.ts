import { useEffect } from 'react';
import { projectEvents } from '../domain/projector';
import { useTaskSelection } from './useTaskSelection';
import { useTaskMutations } from './useTaskMutations';
import type { InlineEditor } from '../components/inlineEditor';
interface ShortcutContext {
  selection: Pick<
    ReturnType<typeof useTaskSelection>,
    | 'selectedTaskId'
    | 'setSelectedTaskId'
    | 'selectedEdgeKeys'
    | 'clearEdgeSelection'
    | 'contextMenu'
    | 'setContextMenu'
  >;
  actions: Pick<
    ReturnType<typeof useTaskMutations>,
    | 'handleUndo'
    | 'handleRedo'
    | 'handleRemoveSelectedEdges'
    | 'handleToggleActive'
    | 'handleCompleteTask'
  >;
  state: ReturnType<typeof projectEvents>;
  showSettingsModal: boolean;
  showShortcutsModal: boolean;
  setShowShortcutsModal: React.Dispatch<React.SetStateAction<boolean>>;
  isMiniMode: boolean;
  snapshotReady: boolean;
  listScrollRef: React.RefObject<HTMLElement>;
  newTaskInputRef: React.RefObject<HTMLInputElement>;
  startInlineEdit: InlineEditor['onStart'];
}
// Routes global keyboard input while respecting editors and overlays.
export function useGlobalShortcuts({
  selection,
  actions,
  state,
  showSettingsModal,
  showShortcutsModal,
  setShowShortcutsModal,
  isMiniMode,
  snapshotReady,
  listScrollRef,
  newTaskInputRef,
  startInlineEdit,
}: ShortcutContext) {
  const {
    selectedTaskId,
    setSelectedTaskId,
    selectedEdgeKeys,
    clearEdgeSelection,
    contextMenu,
    setContextMenu,
  } = selection;
  const {
    handleUndo,
    handleRedo,
    handleRemoveSelectedEdges,
    handleToggleActive,
    handleCompleteTask,
  } = actions;
  // Reinstall from each render so native listeners never retain obsolete editors or DB snapshots.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isMiniMode || showSettingsModal) return;
      // Dismiss the top overlay before focus/shortcut guards, without acting below it.
      if (showShortcutsModal || contextMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowShortcutsModal(false);
          setContextMenu(null);
        }
        return;
      }
      if (!snapshotReady) return;
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          Boolean(
            target.closest('button,a,select,[role="button"],[role="switch"]')
          ));

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey
      ) {
        if (!isInputFocused) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        if (!isInputFocused) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      const isTextEntryFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (
        !isTextEntryFocused &&
        (e.key === 'Home' ||
          e.key === 'End' ||
          e.key === 'PageUp' ||
          e.key === 'PageDown')
      ) {
        const scrollArea = listScrollRef.current;
        if (!scrollArea) return;
        e.preventDefault();
        const top =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? scrollArea.scrollHeight - scrollArea.clientHeight
              : scrollArea.scrollTop +
                (e.key === 'PageUp' ? -1 : 1) * scrollArea.clientHeight;
        scrollArea.scrollTo({
          top,
          behavior:
            e.key === 'PageUp' || e.key === 'PageDown' ? 'smooth' : 'auto',
        });
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInputFocused && !target?.closest('[data-edge-key]')) return;

      if (e.key === 'Escape') {
        setSelectedTaskId(null);
        clearEdgeSelection();
        setContextMenu(null);
        setShowShortcutsModal(false);
        return;
      }

      // Delete/Backspace on a focused edge, otherwise remove any selected dependencies.
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedEdgeKeys.length > 0 &&
        (target?.closest('[data-edge-key]') || !isInputFocused)
      ) {
        e.preventDefault();
        handleRemoveSelectedEdges(selectedEdgeKeys);
        return;
      }

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newTaskInputRef.current?.focus();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal((v) => !v);
        return;
      }

      const taskOrder = state.listEntries
        .filter((entry) => entry.kind === 'task')
        .map((entry) => (entry.kind === 'task' ? entry.task.id : ''));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (taskOrder.length === 0) return;
        clearEdgeSelection();
        if (!selectedTaskId) {
          setSelectedTaskId(taskOrder[0]);
        } else {
          const idx = taskOrder.indexOf(selectedTaskId);
          const nextIdx = Math.min(taskOrder.length - 1, idx + 1);
          setSelectedTaskId(taskOrder[nextIdx]);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (taskOrder.length === 0) return;
        clearEdgeSelection();
        if (!selectedTaskId) {
          setSelectedTaskId(taskOrder[taskOrder.length - 1]);
        } else {
          const idx = taskOrder.indexOf(selectedTaskId);
          const prevIdx = Math.max(0, idx - 1);
          setSelectedTaskId(taskOrder[prevIdx]);
        }
        return;
      }

      if (!selectedTaskId || !state.tasks[selectedTaskId]) return;
      const selTask = state.tasks[selectedTaskId];

      if (e.key === ' ' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleToggleActive(selTask);
        return;
      }

      if (e.key === 'F2' || e.key.toLowerCase() === 'e' || e.key === 'Enter') {
        e.preventDefault();
        startInlineEdit(selTask);
        return;
      }

      if (e.key === 'Delete' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleCompleteTask(selTask.id);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });
}
