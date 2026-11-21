import { selectionActionIds } from '../domain/selection';
import { newTaskMemberships } from '../domain/projects';
import { dayMarkers, markerStart } from '../domain/timeMarkers';
import { eventBridge } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
import { calculateQuickResubmitDate, dateKeyToIsoStart, formatIso8601Display, projectEvents, toDateKey } from '../domain/projector';
import type { QuickResubmitTargetId } from '../domain/projector';
import { applyCommand, copyReplayTasks, replayCommands } from '../domain/commands';
import { parseCommand, commandTaskId, type EventCommand } from '../domain/eventSchema';
import { dependencyPathEdges } from '../domain/dependencyPaths';
import type { useDatabaseSnapshot } from './useDatabaseSnapshot';
import type { useTaskSelection } from './useTaskSelection';
import type { DragIdentity } from './useTaskDrag';
import type { PushToast } from './useToasts';
import { t, formatNumber } from '../i18n';

type CurrentState = ReturnType<typeof projectEvents>;

// Freeze user intent (members/drag identity) on admission. Read task state, derive
// commands and validate the complete batch only when its FIFO turn starts.
// In particular two queued "+1 day" actions must advance twice, not write the
// same date twice. SQLite remains the final authority and revalidates atomically.
export function useTaskMutations(
  database: Pick<ReturnType<typeof useDatabaseSnapshot>, 'mutate' | 'databaseIdentity' | 'confirmedEvents'>,
  selection: Pick<ReturnType<typeof useTaskSelection>, 'selectedTaskIds' | 'setSelectedTaskIds' | 'setSelectedTaskId' | 'clearEdgeSelection'>,
  now: Date,
  dragIdentity: React.MutableRefObject<DragIdentity | null>,
  setLastMovedKey: (key: string) => void,
  pushToast: PushToast,
  refreshNow?: (now: Date) => void,
  projectIds: readonly string[] = []
) {
  const { mutate, databaseIdentity, confirmedEvents } = database;
  const { selectedTaskIds, setSelectedTaskIds, setSelectedTaskId, clearEdgeSelection } = selection;
  const taskGroup = (taskId: string, fromDrag: boolean, includeCompleted = true) => {
    const identity = dragIdentity.current;
    if (fromDrag && (!identity || identity.database !== databaseIdentity.current || identity.taskId !== taskId)) return [];
    const ids = fromDrag ? identity!.taskIds : selectionActionIds(taskId, selectedTaskIds);
    return present([...new Set(ids)], projectEvents(confirmedEvents.current, now), includeCompleted);
  };
  const present = (ids: readonly string[], current: CurrentState, includeCompleted = true) =>
    ids.filter(id => current.tasks[id] && (includeCompleted || !current.tasks[id].completed));
  const reopen = (id: string, current: CurrentState): EventCommand[] =>
    current.tasks[id].completed ? [{ type: 'TASK_REOPENED', payload: { taskId: id } }] : [];

  // Moving a task ends its active override. Inline date editing writes only the
  // date event and deliberately retains activity. Keep both changes in one batch
  // so failed writes and undo cannot leave a half-applied move.
  const deactivate = (id: string, current: CurrentState): EventCommand[] =>
    current.tasks[id].isActive ? [{ type: 'TASK_ACTIVE_SET', payload: { taskId: id, isActive: false } }] : [];

  const commit = async (
    build: (current: CurrentState) => EventCommand[],
    onInvalid?: (command: EventCommand) => void,
    at = now
  ) => {
    let committed: EventCommand[] = [];
    const updated = await mutate(async () => {
      const replay = replayCommands(confirmedEvents.current);
      const commands = build(projectEvents(confirmedEvents.current, at)).map(parseCommand);
      const proposed = copyReplayTasks(replay);
      const effective: EventCommand[] = [];
      for (const command of commands) {
        try { if (applyCommand(proposed, command)) effective.push(command); }
        catch (error) {
          if (!onInvalid) throw error;
          onInvalid(command);
          return confirmedEvents.current;
        }
      }
      if (!effective.length) return confirmedEvents.current;
      const events = await eventBridge.appendBatch(effective);
      committed = effective;
      return events;
    });
    return updated && committed.length ? { events: updated, commands: committed } : null;
  };

  const handleToggleActive = async (task: TaskState) => {
    setLastMovedKey(`task:${task.id}`);
    refreshNow?.(new Date());
    await commit(current => present([task.id], current, false).map(id => ({
      type: 'TASK_ACTIVE_SET', payload: { taskId: id, isActive: !current.tasks[id].isActive },
    })));
  };

  const handleSetConfiguredDate = async (taskId: string, isoDate: string, humanLabel: string, fromDrag = false) => {
    const ids = taskGroup(taskId, fromDrag);
    if (!ids.length) return;
    // Drag targets are already technical ISO instants, not displayed input.
    const configuredStart = isoDate;
    setLastMovedKey(`task:${taskId}`);
    const result = await commit(current => present(ids, current).flatMap(id => [
      ...reopen(id, current),
      ...deactivate(id, current),
      { type: 'TASK_START_DATE_SET' as const, payload: { taskId: id, configuredStart } },
    ]));
    if (result) pushToast(t('Startdatum von {id} → {date}', {
      id: ids.join(', '), date: /^\d{4}-\d{2}-\d{2}$/.test(humanLabel) ? formatIso8601Display(isoDate).localizedText : humanLabel,
    }), 'info');
  };

  const handleResubmitTasks = async (taskId: string, target: QuickResubmitTargetId, fromDrag = false) => {
    const ids = taskGroup(taskId, fromDrag);
    if (!ids.length) return;
    await commit(current => present(ids, current).flatMap(id => [
      ...reopen(id, current),
      ...deactivate(id, current),
      { type: 'TASK_START_DATE_SET' as const, payload: { taskId: id, configuredStart: calculateQuickResubmitDate(target, current.tasks[id]) } },
    ]));
  };

  const handleSetTimeMarker = async (taskId: string, markerId: string) => {
    const ids = taskGroup(taskId, true);
    if (!ids.length) return;
    setLastMovedKey(`task:${taskId}`);
    await commit(current => {
      const marker = current.timeline.markers.get(markerId);
      if (!marker || marker.removed) return [];
      return present(ids, current).flatMap(id => [
        ...reopen(id, current), ...deactivate(id, current),
        ...(current.tasks[id].effectiveDateKey !== marker.dateKey || toDateKey(new Date(current.tasks[id].configuredStart)) > marker.dateKey ? [{
          type: 'TASK_START_DATE_SET' as const, payload: { taskId: id, configuredStart: dateKeyToIsoStart(marker.dateKey) },
        }] : []),
        { type: 'TASK_TIME_MARKER_SET' as const, payload: { taskId: id, markerId } },
      ]);
    });
  };

  // Insertion is a distinct target from a task card (which still sets a dependency).
  // Anchor-relative events retain hidden tasks and work without numeric rank repair.
  const handleInsertTask = async (taskId: string, relativeTaskId: string, side: 'before' | 'after') => {
    const ids = taskGroup(taskId, true);
    if (!ids.length || ids.includes(relativeTaskId)) return;
    setLastMovedKey(`task:${taskId}`);
    await commit(current => {
      const target = current.tasks[relativeTaskId];
      if (!target || target.completed) return [];
      const members = present(ids, current).map(id => current.tasks[id])
        .sort((a, b) => (a.manualOrder ?? a.creationOrder) - (b.manualOrder ?? b.creationOrder));
      // A sorting gesture does not silently activate work. Dropping on a date
      // remains the explicit existing way to reschedule/deactivate active work.
      if (members.some(task => task.isActive !== target.isActive)) return [];
      const marker = dayMarkers(current.timeline, target.effectiveDateKey).find(item => item.minute === target.sortSlot && Date.parse(markerStart(item)) > now.getTime());
      if (side === 'after') members.reverse();
      return members.flatMap(task => [
        ...reopen(task.id, current),
        ...(!target.isActive && task.effectiveDateKey !== target.effectiveDateKey ? [{
          type: 'TASK_START_DATE_SET' as const, payload: { taskId: task.id, configuredStart: dateKeyToIsoStart(target.effectiveDateKey) },
        }] : []),
        ...(!target.isActive ? [{ type: 'TASK_TIME_MARKER_SET' as const, payload: { taskId: task.id, markerId: marker?.id ?? null } }] : []),
        { type: 'TASK_REORDERED' as const, payload: { taskId: task.id, relativeTaskId, side } },
      ]);
    });
  };

  const handleAddPredecessor = async (draggedId: string, targetTaskId: string) => {
    const ids = taskGroup(draggedId, true).filter(id => id !== targetTaskId);
    if (!ids.length) return;
    setLastMovedKey(`task:${draggedId}`);
    await commit(current => !current.tasks[targetTaskId] ? [] : present(ids, current).flatMap(id => [
      ...reopen(id, current),
      ...deactivate(id, current),
      { type: 'DEPENDENCY_ADDED' as const, payload: { taskId: id, predecessorId: targetTaskId } },
    ]), command => pushToast(t('Zyklus verhindert: {id} ist bereits Vorgänger von {target}', {
      id: commandTaskId(command), target: targetTaskId,
    }), 'warning'));
  };

  const handleRemovePredecessor = async (taskId: string, predecessorId: string) => {
    setLastMovedKey(`task:${taskId}`);
    await commit(current => !current.tasks[taskId] || !current.tasks[predecessorId] ? [] : [
      { type: 'DEPENDENCY_REMOVED', payload: { taskId, predecessorId } },
    ]);
  };

  const handleRemoveSelectedEdges = async (keys: string[]) => {
    const frozen = [...keys];
    if (!frozen.length) return;
    const result = await commit(current => frozen.flatMap(key => {
      const [from, to] = key.split('->');
      return current.tasks[from] && current.tasks[to] ? [{
        type: 'DEPENDENCY_REMOVED' as const, payload: { taskId: to, predecessorId: from },
      }] : [];
    }));
    if (!result) return;
    clearEdgeSelection();
    const count = result.commands.length;
    const first = result.commands[0];
    const edge = first.type === 'DEPENDENCY_REMOVED' ? `${first.payload.predecessorId} → ${first.payload.taskId}` : '';
    pushToast(count === 1
      ? t('Kante {edge} gelöscht', { edge })
      : t('{count} Kanten gelöscht', { count: formatNumber(count) }), 'info');
  };

  const handleRemoveDependencyBetween = async (draggedId: string, targetTaskId: string) => {
    if (dragIdentity.current?.database !== databaseIdentity.current || dragIdentity.current.taskId !== draggedId) return;
    const result = await commit(current => !current.tasks[draggedId] ? [] : [
      ...reopen(draggedId, current),
      ...dependencyPathEdges(current.tasks, draggedId, targetTaskId).map(edge => ({
        type: 'DEPENDENCY_REMOVED' as const, payload: { taskId: edge.to, predecessorId: edge.from },
      })),
    ]);
    const count = result?.commands.filter(command => command.type === 'DEPENDENCY_REMOVED').length ?? 0;
    if (count) pushToast(t('{count} Kanten an {id} geloescht', { count: formatNumber(count), id: draggedId }), 'info');
  };

  const handleCompleteTask = async (taskId: string, fromDrag = false) => {
    const ids = taskGroup(taskId, fromDrag, false);
    if (!ids.length) return;
    const completedAt = new Date().toISOString();
    const result = await commit(current => present(ids, current, false).map(id => ({
      type: 'TASK_COMPLETED', payload: { taskId: id, completedAt },
    })));
    if (result) setSelectedTaskIds(current => current.filter(id => !ids.includes(id)));
  };

  const handleReopenTask = async (taskId: string) => {
    setLastMovedKey(`task:${taskId}`);
    const result = await commit(current => current.tasks[taskId] ? reopen(taskId, current) : []);
    if (result) {
      clearEdgeSelection();
      setSelectedTaskId(taskId);
    }
  };

  const handleOpenCopy = async (sourceId: string) => {
    const createdAt = new Date();
    const result = await commit(current => {
      const source = current.tasks[sourceId];
      if (!source) return [];
      const { nextTaskId: taskId } = current;
      const suffix = /\((\d+)\)$/.exec(source.title);
      const title = suffix
        ? source.title.slice(0, suffix.index) + `(${BigInt(suffix[1]) + 1n})`
        : `${source.title} (2)`;
      return [
        { type: 'TASK_CREATED', payload: {
          taskId, title, configuredStart: dateKeyToIsoStart(toDateKey(createdAt)),
          createdAt: createdAt.toISOString(), copiedFromId: sourceId,
        } },
        ...newTaskMemberships(taskId, projectIds),
        { type: 'TASK_DESCRIPTION_SET', payload: { taskId, description: source.description } },
        { type: 'TASK_TIMING_SET', payload: { taskId, duration: source.duration, durationUnit: source.durationUnit, progress: null } },
        { type: 'DEPENDENCY_ADDED', payload: { taskId, predecessorId: sourceId } },
      ];
    }, undefined, createdAt);
    if (result) {
      clearEdgeSelection();
      setSelectedTaskId(commandTaskId(result.commands[0]));
      refreshNow?.(new Date());
    }
  };

  const handleUndo = async () => {
    await mutate(() => replayCommands(confirmedEvents.current).activeEventCount
      ? eventBridge.undo() : Promise.resolve(confirmedEvents.current));
  };
  const handleRedo = async () => {
    await mutate(() => replayCommands(confirmedEvents.current).canRedo
      ? eventBridge.redo() : Promise.resolve(confirmedEvents.current));
  };

  return { handleToggleActive, handleSetConfiguredDate, handleResubmitTasks, handleInsertTask, handleSetTimeMarker,
    handleAddPredecessor, handleRemovePredecessor, handleRemoveSelectedEdges, handleRemoveDependencyBetween,
    handleCompleteTask, handleReopenTask, handleOpenCopy, handleUndo, handleRedo };
}
