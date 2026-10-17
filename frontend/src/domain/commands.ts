import { EventCommand, parseStoredEvent } from './eventSchema';
import { StoredEvent } from './types';

export interface ReplayTask {
  readonly id: string;
  readonly title: string;
  readonly creationOrder: number;
  readonly createdAt: string;
  readonly configuredStart: string;
  readonly completed: boolean;
  readonly completedAt?: string;
  readonly isActive: boolean;
  readonly predecessors: ReadonlySet<string>;
}
type MutableTask = { -readonly [K in keyof ReplayTask]: ReplayTask[K] } & { predecessors: Set<string> };
export interface ReplayState {
  readonly tasks: ReadonlyMap<string, ReplayTask>;
  readonly orderedTasks: readonly ReplayTask[];
  readonly activeEventCount: number;
  readonly canRedo: boolean;
}
// Event arrays are immutable history versions. Minute ticks reuse their domain state.
const replayCache = new WeakMap<readonly StoredEvent[], ReplayState>();

export function replayCommands(events: readonly StoredEvent[]): ReplayState {
  const cached = replayCache.get(events);
  if (cached) return cached;
  const tasks = new Map<string, MutableTask>();
  const ids = new Set<string>();
  let previousSeq = 0;
  let activeEventCount = 0;
  let canRedo = false;
  for (const input of events) {
    const event = parseStoredEvent(input);
    if (ids.has(event.id) || event.seq <= previousSeq) throw new Error('Duplicate ID or unordered event sequence');
    ids.add(event.id);
    previousSeq = event.seq;
    canRedo ||= event.undone;
    if (event.undone) continue;
    activeEventCount++;
    // Historical intermediate cycles are allowed; validate only the final graph.
    applyCommand(tasks, event, false);
  }
  const successors = new Map<string, string[]>();
  const degree = new Map<string, number>();
  const queue: ReplayTask[] = [];
  for (const task of tasks.values()) {
    successors.set(task.id, []);
    degree.set(task.id, task.predecessors.size);
    if (!task.predecessors.size) queue.push(task);
  }
  for (const task of tasks.values()) {
    for (const pred of task.predecessors) successors.get(pred)!.push(task.id);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const id of successors.get(queue[i].id)!) {
      const remaining = degree.get(id)! - 1;
      degree.set(id, remaining);
      if (!remaining) queue.push(tasks.get(id)!);
    }
  }
  if (queue.length !== tasks.size) throw new Error('Dependency cycle in final event history');
  const state: ReplayState = { tasks, orderedTasks: queue, activeEventCount, canRedo };
  replayCache.set(events, state);
  return state;
}

export function copyReplayTasks(state: ReplayState): Map<string, MutableTask> {
  return new Map([...state.tasks].map(([id, task]) => [id, { ...task, predecessors: new Set(task.predecessors) }]));
}

export function applyCommand(tasks: Map<string, MutableTask>, command: EventCommand, checkCycle = true): boolean {
  const p = command.payload;
  const task = tasks.get(p.taskId);
  if (command.type === 'TASK_CREATED') {
    if (task) throw new Error(`Duplicate task ID: ${p.taskId}`);
    tasks.set(p.taskId, {
      id: p.taskId,
      title: command.payload.title,
      creationOrder: tasks.size + 1,
      createdAt: command.payload.createdAt,
      configuredStart: command.payload.configuredStart,
      completed: false,
      isActive: false,
      predecessors: new Set(),
    });
    return true;
  }
  if (!task) throw new Error(`Unknown task: ${p.taskId}`);
  switch (command.type) {
    case 'TASK_RENAMED':
      if (task.title === command.payload.title) return false;
      task.title = command.payload.title;
      break;
    case 'TASK_START_DATE_SET':
      if (Date.parse(task.configuredStart) === Date.parse(command.payload.configuredStart)) return false;
      task.configuredStart = command.payload.configuredStart;
      break;
    case 'TASK_ACTIVE_SET':
      if (task.isActive === command.payload.isActive) return false;
      if (command.payload.isActive &&
        (task.completed || [...task.predecessors].some(id => !tasks.get(id)?.completed))) {
        throw new Error('Task has open predecessors or is completed');
      }
      task.isActive = command.payload.isActive;
      break;
    case 'TASK_COMPLETED':
      if (task.completed) return false;
      task.completed = true;
      task.completedAt = command.payload.completedAt;
      task.isActive = false;
      break;
    case 'TASK_REOPENED':
      if (!task.completed) return false;
      task.completed = false;
      task.completedAt = undefined;
      break;
    case 'DEPENDENCY_ADDED': {
      const pred = command.payload.predecessorId;
      if (!tasks.has(pred)) throw new Error(`Unknown predecessor: ${pred}`);
      if (task.predecessors.has(pred)) return false;
      const stack = checkCycle ? [pred] : [];
      const visited = new Set<string>();
      while (stack.length) {
        const current = stack.pop()!;
        if (current === p.taskId) throw new Error('Dependency cycle');
        if (visited.has(current)) continue;
        visited.add(current);
        stack.push(...tasks.get(current)!.predecessors);
      }
      task.predecessors.add(pred);
      break;
    }
    case 'DEPENDENCY_REMOVED':
      if (!tasks.has(command.payload.predecessorId)) throw new Error('Unknown predecessor');
      return task.predecessors.delete(command.payload.predecessorId);
  }
  return true;
}
