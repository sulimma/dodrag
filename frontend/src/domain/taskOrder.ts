import type { StoredEvent } from './types';

/**
 * One database-wide order, independent of dates, activity and dependencies.
 * Persist moves relative to a task, not floating-point ranks or graph edges.
 * Hidden/completed tasks remain in this sequence: moving only a subset between
 * days or toggling activity cannot change their relative order. A deliberate
 * insertion changes that task's position globally. Undo replays the same moves.
 * The task snapshot cache remains concerned with task/dependency state; order
 * is a separate projection of the authoritative events.
 */
export function projectTaskOrder(events: readonly StoredEvent[]): Map<string, number> {
  const ids: string[] = [];
  for (const event of events) {
    if (event.undone) continue;
    if (event.type === 'TASK_CREATED') ids.push(event.payload.taskId);
    if (event.type === 'TASK_REORDERED') {
      const { taskId, relativeTaskId, side } = event.payload;
      const from = ids.indexOf(taskId);
      if (from < 0 || taskId === relativeTaskId || !ids.includes(relativeTaskId)) continue;
      ids.splice(from, 1);
      ids.splice(ids.indexOf(relativeTaskId) + (side === 'after' ? 1 : 0), 0, taskId);
    }
  }
  return new Map(ids.map((id, index) => [id, index]));
}
