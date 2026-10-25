import { eventBridge } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import {
  calculateQuickResubmitDate,
  formatIso8601Display,
  projectEvents,
} from '../domain/projector';
import type { QuickResubmitTargetId } from '../domain/projector';
import { applyCommand, copyReplayTasks, replayCommands } from '../domain/commands';
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
    'selectedTaskIds' | 'setSelectedTaskIds' | 'clearEdgeSelection'
  >,
  state: ReturnType<typeof projectEvents>,
  now: Date,
  dragIdentity: React.MutableRefObject<DragIdentity | null>,
  setLastMovedKey: (key: string) => void,
  pushToast: PushToast
) {
  const { mutate, databaseIdentity, confirmedEvents } = database;
  const { selectedTaskIds, setSelectedTaskIds, clearEdgeSelection } = selection;
  const taskGroup = (taskId: string, fromDrag: boolean, includeCompleted = true) => {
    const identity = dragIdentity.current;
    if (fromDrag && (!identity || identity.database !== databaseIdentity.current || identity.taskId !== taskId)) return [];
    const ids = fromDrag ? identity!.taskIds : selectedTaskIds.includes(taskId) ? selectedTaskIds : [taskId];
    const current = projectEvents(confirmedEvents.current, now);
    return [...new Set(ids)].filter(id => current.tasks[id] && (includeCompleted || !current.tasks[id].completed));
  };
  const reopenCommand = (id: string, tasks: ReturnType<typeof projectEvents>['tasks']) =>
    tasks[id].completed
      ? { type: 'TASK_REOPENED' as const, payload: { taskId: id } }
      : null;
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
    humanLabel: string,
    fromDrag = false
  ) => {
    const ids = taskGroup(taskId, fromDrag);
    if (!ids.length) return;
    const configuredStart = normalizeUserDate(
      formatIso8601Display(isoDate).isoText,
      now
    );
    const current = projectEvents(confirmedEvents.current, now);
    const commands = ids.flatMap(id => {
      const reopen = reopenCommand(id, current.tasks);
      return [
        ...(reopen ? [reopen] : []),
        ...(Date.parse(current.tasks[id].configuredStart) !== Date.parse(configuredStart)
          ? [{ type: 'TASK_START_DATE_SET' as const, payload: { taskId: id, configuredStart } }]
          : []),
      ];
    });
    if (!commands.length) return;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() =>
      eventBridge.appendBatch(commands)
    );
    if (!updated) return;
    pushToast(t('Startdatum von {id} → {date}', { id: ids.join(', '), date: /^\d{4}-\d{2}-\d{2}$/.test(humanLabel) ? formatIso8601Display(isoDate).localizedText : humanLabel }), 'info');
  };

  const handleResubmitTasks = async (taskId: string, target: QuickResubmitTargetId, fromDrag = false) => {
    const ids = taskGroup(taskId, fromDrag);
    if (!ids.length) return;
    const current = projectEvents(confirmedEvents.current, now);
    const commands = ids.flatMap(id => {
      const reopen = reopenCommand(id, current.tasks);
      return [
        ...(reopen ? [reopen] : []),
        {
          type: 'TASK_START_DATE_SET' as const,
          payload: { taskId: id, configuredStart: calculateQuickResubmitDate(target, current.tasks[id]) },
        },
      ];
    });
    if (!commands.length) return;
    await mutate(() => eventBridge.appendBatch(commands));
  };

  const handleAddPredecessor = async (
    draggedId: string,
    targetTaskId: string
  ) => {
    const ids = taskGroup(draggedId, true).filter(id => id !== targetTaskId);
    if (!ids.length) return;
    const replay = replayCommands(confirmedEvents.current);
    if (!replay.tasks.has(targetTaskId)) return;
    const commands = ids.flatMap(id => {
      const task = replay.tasks.get(id)!;
      return [
        ...(task.completed ? [{ type: 'TASK_REOPENED' as const, payload: { taskId: id } }] : []),
        ...(!task.predecessors.has(targetTaskId)
          ? [{ type: 'DEPENDENCY_ADDED' as const, payload: { taskId: id, predecessorId: targetTaskId } }]
          : []),
      ];
    });
    if (!commands.length) return;
    // Validate the complete proposed graph before sending any command to the backend.
    const proposed = copyReplayTasks(replay);
    for (const command of commands) {
      try { applyCommand(proposed, command); }
      catch {
        pushToast(t('Zyklus verhindert: {id} ist bereits Vorgänger von {target}', { id: command.payload.taskId, target: targetTaskId }), 'warning');
        return;
      }
    }
    setLastMovedKey(`task:${draggedId}`);
    await mutate(() => eventBridge.appendBatch(commands));
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
    const source = current.tasks[draggedId];
    if (!source) return;
    const edges = dependencyPathEdges(current.tasks, draggedId, targetTaskId);
    const reopen = reopenCommand(draggedId, current.tasks);
    const commands = [
      ...(reopen ? [reopen] : []),
      ...edges.map((edge) => ({
        type: 'DEPENDENCY_REMOVED' as const,
        payload: { taskId: edge.to, predecessorId: edge.from },
      })),
    ];
    if (!commands.length) return;
    const updated = await mutate(() => eventBridge.appendBatch(commands));
    if (updated && edges.length)
      pushToast(t('{count} Kanten an {id} geloescht', { count: formatNumber(edges.length), id: draggedId }), 'info');
  };

  const handleCompleteTask = async (taskId: string, fromDrag = false) => {
    const ids = taskGroup(taskId, fromDrag, false);
    if (!ids.length) return;
    const completedAt = new Date().toISOString();
    const updated = await mutate(() =>
      eventBridge.appendBatch(ids.map(id => ({ type: 'TASK_COMPLETED' as const, payload: { taskId: id, completedAt } })))
    );
    if (!updated) return;
    // A late completion must not clear a different task selected while saving.
    setSelectedTaskIds(current => current.filter(id => !ids.includes(id)));
  };

  const handleUndo = async () => {
    if (!state.canUndo) return;
    await mutate(() => eventBridge.undo());
  };

  const handleReopenTask = async (taskId: string) => {
    const task = projectEvents(confirmedEvents.current, now).tasks[taskId];
    if (!task?.completed) return;
    setLastMovedKey(`task:${taskId}`);
    await mutate(() => eventBridge.appendEvent('TASK_REOPENED', { taskId }));
  };

  const handleRedo = async () => {
    if (!state.canRedo) return;
    await mutate(() => eventBridge.redo());
  };
  return {
    handleToggleActive,
    handleSetConfiguredDate,
    handleResubmitTasks,
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
