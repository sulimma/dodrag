import { EventCommand, parseStoredEvent } from './eventSchema';
import type { StoredEvent, TaskLogEntry } from './types';
import { t } from '../i18n';

export interface ReplayTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly logEntries: readonly TaskLogEntry[];
  readonly creationOrder: number;
  readonly createdAt: string;
  readonly configuredStart: string;
  readonly completed: boolean;
  readonly completedAt?: string;
  readonly isActive: boolean;
  readonly predecessors: ReadonlySet<string>;
}
type MutableTask = { -readonly [K in keyof ReplayTask]: ReplayTask[K] } & { predecessors: Set<string>; logEntries: TaskLogEntry[] };
export interface ReplayState {
  readonly tasks: ReadonlyMap<string, ReplayTask>;
  readonly orderedTasks: readonly ReplayTask[];
  readonly activeEventCount: number;
  readonly canRedo: boolean;
}
interface ReplayCacheEntry {
  events: StoredEvent[];
  state: ReplayState;
  ids: ReadonlySet<string>;
  tailBefore?: ReplayTask;
}
// Only our frozen, detached history versions can bypass input verification.
const replayCache = new WeakMap<readonly StoredEvent[], ReplayCacheEntry>();
const rawPayloadStrings = new WeakMap<StoredEvent, string>();
let latestReplay: ReplayCacheEntry | undefined;
const coalescingTypes = new Set(['TASK_RENAMED', 'TASK_START_DATE_SET', 'TASK_ACTIVE_SET', 'TASK_DESCRIPTION_SET']);

function sameEvent(input: unknown, event: StoredEvent): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const raw = input as Record<string, unknown>;
  if (raw.seq !== event.seq || raw.id !== event.id || raw.timestamp !== event.timestamp ||
      raw.type !== event.type || raw.undone !== event.undone || raw.groupId !== event.groupId) return false;
  if (typeof raw.payload === 'string') {
    return raw.payload === rawPayloadStrings.get(event) || raw.payload === JSON.stringify(event.payload);
  }
  if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) return false;
  const payload = raw.payload as Record<string, unknown>;
  const keys = Object.keys(event.payload);
  return Object.keys(payload).length === keys.length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(payload, key) && payload[key] === (event.payload as Record<string, unknown>)[key]);
}

function cloneTask(task: ReplayTask): MutableTask {
  return { ...task, predecessors: new Set(task.predecessors), logEntries: task.logEntries.map(entry => ({ ...entry })) };
}

function orderTasks(tasks: ReadonlyMap<string, ReplayTask>): ReplayTask[] {
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
  if (queue.length !== tasks.size) throw new Error(t('Dependency cycle in final event history'));
  return queue;
}

export function normalizeReplayEvents(input: readonly unknown[]): StoredEvent[] {
  const cached = replayCache.get(input as readonly StoredEvent[]);
  if (cached) return cached.events;
  const previous = latestReplay;
  // Full transport still imposes an O(E) identity check/serialization ceiling.
  // A future delta transport can remove it without weakening this input boundary.
  let prefix = 0;
  const events = input.map((raw, index) => {
    const old = previous?.events[index];
    if (old && sameEvent(raw, old)) {
      if (prefix === index) prefix++;
      return old;
    }
    const event = parseStoredEvent(raw);
    Object.freeze(event.payload);
    Object.freeze(event);
    // Go JSON maps and the command schema use different key orders. Remember
    // only the exact string that produced this validated, detached event.
    const payload = (raw as Record<string, unknown>).payload;
    if (typeof payload === 'string') rawPayloadStrings.set(event, payload);
    return event;
  });
  if (previous && prefix === events.length && events.length === previous.events.length) return previous.events;
  const append = previous && prefix === previous.events.length && events.length > prefix;
  const oldTail = previous?.events[previous.events.length - 1];
  const newTail = events[events.length - 1];
  const coalesce = previous && events.length === previous.events.length && prefix === events.length - 1 &&
    previous.tailBefore && oldTail && newTail && !oldTail.undone && !newTail.undone &&
    coalescingTypes.has(newTail.type) && newTail.type === oldTail.type &&
    newTail.seq === oldTail.seq && newTail.id === oldTail.id && newTail.groupId === oldTail.groupId &&
    newTail.payload.taskId === oldTail.payload.taskId;
  const incremental = append || coalesce;
  const tasks = incremental ? new Map(previous!.state.tasks) as Map<string, MutableTask> : new Map<string, MutableTask>();
  const copied = new Set<string>();
  const ids = append ? new Set(previous!.ids) : new Set<string>();
  let previousSeq = append ? oldTail?.seq ?? 0 : 0;
  let activeEventCount = incremental ? previous!.state.activeEventCount : 0;
  let canRedo = incremental ? previous!.state.canRedo : false;
  let tailBefore: ReplayTask | undefined;
  let topologyChanged = !incremental;
  const start = append ? prefix : coalesce ? events.length - 1 : 0;
  if (coalesce) {
    tasks.set(newTail.payload.taskId, cloneTask(previous!.tailBefore!));
    copied.add(newTail.payload.taskId);
    activeEventCount--;
  }
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    // Coalescing also verifies metadata order/IDs; the unchanged prefix is trusted.
    if (!append) {
      if (ids.has(event.id) || event.seq <= previousSeq) throw new Error(t('Duplicate ID or unordered event sequence'));
      ids.add(event.id);
      previousSeq = event.seq;
    } else if (index >= start) {
      if (ids.has(event.id) || event.seq <= previousSeq) throw new Error(t('Duplicate ID or unordered event sequence'));
      ids.add(event.id);
      previousSeq = event.seq;
    }
    if (index < start) continue;
    canRedo ||= event.undone;
    if (event.undone) continue;
    activeEventCount++;
    const taskId = event.payload.taskId;
    if (index === events.length - 1 && coalescingTypes.has(event.type)) tailBefore = tasks.get(taskId);
    if (incremental && !copied.has(taskId) && tasks.has(taskId)) {
      tasks.set(taskId, cloneTask(tasks.get(taskId)!));
      copied.add(taskId);
    } else if (tailBefore) {
      // A full replay or repeated edits in this batch may own a mutable task.
      tailBefore = cloneTask(tailBefore);
    }
    topologyChanged ||= event.type === 'DEPENDENCY_ADDED' || event.type === 'DEPENDENCY_REMOVED';
    // Historical intermediate cycles are allowed; validate only the final graph.
    applyCommand(tasks, event, false);
  }
  const orderedTasks = topologyChanged ? orderTasks(tasks) : [
    ...previous!.state.orderedTasks.map(task => tasks.get(task.id)!),
    ...[...tasks.values()].filter(task => !previous!.state.tasks.has(task.id)),
  ];
  const state: ReplayState = { tasks, orderedTasks, activeEventCount, canRedo };
  Object.freeze(events);
  const entry = { events, state, ids, tailBefore };
  // Publish only after parsing, application and final topology all succeeded.
  replayCache.set(events, entry);
  latestReplay = entry;
  return events;
}

export function replayCommands(events: readonly StoredEvent[]): ReplayState {
  return replayCache.get(normalizeReplayEvents(events))!.state;
}

export function copyReplayTasks(state: ReplayState): Map<string, MutableTask> {
  return new Map([...state.tasks].map(([id, task]) => [id, {
    ...task, predecessors: new Set(task.predecessors), logEntries: task.logEntries.map(entry => ({ ...entry })),
  }]));
}

export function applyCommand(tasks: Map<string, MutableTask>, command: EventCommand, checkCycle = true): boolean {
  const p = command.payload;
  const task = tasks.get(p.taskId);
  if (command.type === 'TASK_CREATED') {
    if (task) throw new Error(t('Duplicate task ID: {id}', { id: p.taskId }));
    tasks.set(p.taskId, {
      id: p.taskId,
      title: command.payload.title,
      description: '',
      logEntries: [],
      creationOrder: tasks.size + 1,
      createdAt: command.payload.createdAt,
      configuredStart: command.payload.configuredStart,
      completed: false,
      isActive: false,
      predecessors: new Set(),
    });
    return true;
  }
  if (!task) throw new Error(t('Unknown task: {id}', { id: p.taskId }));
  switch (command.type) {
    case 'TASK_RENAMED':
      if (task.title === command.payload.title) return false;
      task.title = command.payload.title;
      break;
    case 'TASK_DESCRIPTION_SET':
      if (task.description === command.payload.description) return false;
      task.description = command.payload.description;
      break;
    case 'TASK_LOG_ADDED': {
      const { entryId, text, createdAt } = command.payload;
      if (task.logEntries.some(entry => entry.id === entryId)) {
        throw new Error(t('Duplicate log entry ID: {id}', { id: entryId }));
      }
      task.logEntries.push({ id: entryId, text: text.trim(), createdAt });
      break;
    }
    case 'TASK_LOG_REMOVED': {
      const index = task.logEntries.findIndex(entry => entry.id === command.payload.entryId);
      if (index < 0) return false;
      task.logEntries.splice(index, 1);
      break;
    }
    case 'TASK_START_DATE_SET':
      if (Date.parse(task.configuredStart) === Date.parse(command.payload.configuredStart)) return false;
      task.configuredStart = command.payload.configuredStart;
      break;
    case 'TASK_ACTIVE_SET':
      if (task.isActive === command.payload.isActive) return false;
      if (command.payload.isActive && task.completed) {
        throw new Error(t('Task is completed'));
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
      if (!tasks.has(pred)) throw new Error(t('Unknown predecessor: {id}', { id: pred }));
      if (task.predecessors.has(pred)) return false;
      const stack = checkCycle ? [pred] : [];
      const visited = new Set<string>();
      while (stack.length) {
        const current = stack.pop()!;
        if (current === p.taskId) throw new Error(t('Dependency cycle'));
        if (visited.has(current)) continue;
        visited.add(current);
        stack.push(...tasks.get(current)!.predecessors);
      }
      task.predecessors.add(pred);
      break;
    }
    case 'DEPENDENCY_REMOVED':
      if (!tasks.has(command.payload.predecessorId)) throw new Error(t('Unknown predecessor'));
      return task.predecessors.delete(command.payload.predecessorId);
  }
  return true;
}
