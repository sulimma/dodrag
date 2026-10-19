import { eventBridge } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import {
  computeDependencyHighlights,
  formatIso8601Display,
  projectEvents,
} from '../domain/projector';
import { normalizeUserDate } from '../domain/dates';
import { dependencyPathEdges } from '../domain/dependencyPaths';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskSelection } from './useTaskSelection';
import type { DragIdentity } from './useTaskDrag';
import type { PushToast } from './useToasts';
import { t, formatNumber } from '../i18n';
// Applies task commands and coordinates their selection and drag effects.
export function useTaskMutations(
  database: Pick<
    ReturnType<typeof useDatabaseSnapshot>,
    'mutate' | 'databaseIdentity' | 'confirmedEvents'
  >,
  selection: Pick<
    ReturnType<typeof useTaskSelection>,
    'setSelectedTaskId' | 'clearEdgeSelection'
  >,
  state: ReturnType<typeof projectEvents>,
  now: Date,
  dragIdentity: React.MutableRefObject<DragIdentity | null>,
  setLastMovedKey: (key: string) => void,
  pushToast: PushToast
) {
  const { mutate, databaseIdentity, confirmedEvents } = database;
  const { setSelectedTaskId, clearEdgeSelection } = selection;
  const handleToggleActive = async (task: TaskState) => {
    if (task.predecessorIds.length > 0) {
      pushToast(
        t('Task {id} hat noch offene Vorgänger und kann nicht aktiviert werden.', { id: task.id }),
        'warning'
      );
      return;
    }
    const nextActive = !task.isActive;
    await mutate(() =>
      eventBridge.appendEvent('TASK_ACTIVE_SET', {
        taskId: task.id,
        isActive: nextActive,
      })
    );
  };

  const handleSetConfiguredDate = async (
    taskId: string,
    isoDate: string,
    humanLabel: string
  ) => {
    if (!state.tasks[taskId]) return;
    if (
      dragIdentity.current &&
      (dragIdentity.current.database !== databaseIdentity.current ||
        dragIdentity.current.taskId !== taskId)
    )
      return;
    const configuredStart = normalizeUserDate(
      formatIso8601Display(isoDate).isoText,
      now
    );
    if (
      Date.parse(state.tasks[taskId].configuredStart) ===
      Date.parse(configuredStart)
    )
      return;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() =>
      eventBridge.appendEvent('TASK_START_DATE_SET', {
        taskId,
        configuredStart,
      })
    );
    if (!updated) return;
    pushToast(t('Startdatum von {id} → {date}', { id: taskId, date: /^\d{4}-\d{2}-\d{2}$/.test(humanLabel) ? formatIso8601Display(isoDate).localizedText : humanLabel }), 'info');
  };

  const handleAddPredecessor = async (
    draggedId: string,
    targetTaskId: string
  ) => {
    if (draggedId === targetTaskId) return;
    const draggedTask = state.tasks[draggedId];
    const targetTask = state.tasks[targetTaskId];
    if (!draggedTask || !targetTask) return;

    if (draggedTask.predecessorIds.includes(targetTaskId)) {
      return;
    }

    const targetHighlights = computeDependencyHighlights(
      targetTaskId,
      state.tasks
    );
    if (
      targetHighlights[draggedId] === 'predecessor-direct' ||
      targetHighlights[draggedId] === 'predecessor-transitive'
    ) {
      pushToast(
        t('Zyklus verhindert: {id} ist bereits Vorgänger von {target}', { id: draggedId, target: targetTaskId }),
        'warning'
      );
      return;
    }

    setLastMovedKey(`task:${draggedId}`);
    const updated = await mutate(() =>
      eventBridge.appendEvent('DEPENDENCY_ADDED', {
        taskId: draggedId,
        predecessorId: targetTaskId,
      })
    );
    if (!updated) return;
    setSelectedTaskId(draggedId);
  };

  const handleRemovePredecessor = async (
    taskId: string,
    predecessorId: string
  ) => {
    setLastMovedKey(`task:${taskId}`);
    await mutate(() =>
      eventBridge.appendEvent('DEPENDENCY_REMOVED', {
        taskId,
        predecessorId,
      })
    );
  };

  const handleRemoveSelectedEdges = async (edgeKeysToRemove: string[]) => {
    if (edgeKeysToRemove.length === 0) return;
    const commands = edgeKeysToRemove.map((key) => {
      const [from, to] = key.split('->');
      return {
        type: 'DEPENDENCY_REMOVED' as const,
        payload: { taskId: to, predecessorId: from },
      };
    });
    const updated = await mutate(() => eventBridge.appendBatch(commands));
    if (!updated) return;
    clearEdgeSelection();
    pushToast(
      edgeKeysToRemove.length === 1
        ? t('Kante {edge} gelöscht', { edge: edgeKeysToRemove[0].replace('->', ' → ') })
        : t('{count} Kanten gelöscht', { count: formatNumber(edgeKeysToRemove.length) }),
      'info'
    );
  };

  // Remove only stored source-incident path edges, recomputed from the confirmed snapshot.
  const handleRemoveDependencyBetween = async (
    draggedId: string,
    targetTaskId: string
  ) => {
    if (
      dragIdentity.current?.database !== databaseIdentity.current ||
      dragIdentity.current.taskId !== draggedId
    )
      return;
    const current = projectEvents(confirmedEvents.current, new Date());
    const edges = dependencyPathEdges(current.tasks, draggedId, targetTaskId);
    if (!edges.length) return;
    const updated = await mutate(() =>
      eventBridge.appendBatch(
        edges.map((edge) => ({
          type: 'DEPENDENCY_REMOVED' as const,
          payload: { taskId: edge.to, predecessorId: edge.from },
        }))
      )
    );
    if (updated)
      pushToast(t('{count} Kanten an {id} geloescht', { count: formatNumber(edges.length), id: draggedId }), 'info');
  };

  const handleCompleteTask = async (taskId: string) => {
    const updated = await mutate(() =>
      eventBridge.appendEvent('TASK_COMPLETED', {
        taskId,
        completedAt: new Date().toISOString(),
      })
    );
    if (!updated) return;
    // A late completion must not clear a different task selected while saving.
    setSelectedTaskId(current => current === taskId ? null : current);
  };

  const handleReopenTask = async (taskId: string) => {
    setLastMovedKey(`task:${taskId}`);
    await mutate(() =>
      eventBridge.appendEvent('TASK_REOPENED', {
        taskId,
      })
    );
  };

  const handleUndo = async () => {
    if (!state.canUndo) return;
    await mutate(() => eventBridge.undo());
  };

  const handleRedo = async () => {
    if (!state.canRedo) return;
    await mutate(() => eventBridge.redo());
  };
  return {
    handleToggleActive,
    handleSetConfiguredDate,
    handleAddPredecessor,
    handleRemovePredecessor,
    handleRemoveSelectedEdges,
    handleRemoveDependencyBetween,
    handleCompleteTask,
    handleReopenTask,
    handleUndo,
    handleRedo,
  };
}
