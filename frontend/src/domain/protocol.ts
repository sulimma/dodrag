import type { StoredEvent, TaskState } from './types';
import { toDateKey } from './projector';
import { tokenizeTargets } from '../components/editor/targets';
import type { EditorTarget } from '../components/editor/types';

export type ProtocolAction = { timestamp: string } & (
  | { key: string; kind: 'created' | 'completed' | 'reopened' }
  | { key: string; kind: 'source'; target: EditorTarget }
  | { key: string; kind: 'renamed'; oldTitle: string }
  | { key: string; kind: 'log'; text: string });
export interface ProtocolTaskEntry {
  key: string;
  taskId: string;
  dateKey: string;
  actions: ProtocolAction[];
}
export interface ProtocolDay { dateKey: string; entries: ProtocolTaskEntry[] }

function sources(text: string): Map<string, EditorTarget> {
  return new Map(tokenizeTargets(text).map(({ kind, value }) => [
    kind === 'path' ? `path:${value.replace(/\\+$/, '').toLowerCase()}` : `url:${value}`,
    { kind, value },
  ]));
}

// This is a complete, DOM-independent history projection, not a recent-day cache.
// Future search/filtering must operate on these entries before windowing the UI.
// Sequence is the execution order (including equal timestamps); local calendar
// days match the regular list. Undo removes events, redo restores them. Headers
// use current task state/topology so all shared actions operate on today's task.
// Only visible essential actions create task/day headers. Dates, dependencies
// and activation never create protocol entries. Source additions compare saved snapshots,
// never the live filesystem, so historical sources survive moves/deletions.
export function projectProtocol(events: readonly StoredEvent[], tasks: Record<string, TaskState>): ProtocolDay[] {
  const days = new Map<string, Map<string, ProtocolTaskEntry>>();
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const logs = new Map<string, string>();
  // Track each saved source location separately. A same-day removal cancels
  // that addition; removal on a later day preserves the historical event.
  const additions = new Map<string, Map<string, { dateKey: string; action: ProtocolAction }>>();
  const hidden = new Set<ProtocolAction>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.undone || event.type === 'TASK_ACTIVE_SET') continue;
    const taskId = event.payload.taskId;
    if (!tasks[taskId]) continue;
    const dateKey = toDateKey(new Date(event.timestamp));
    let day = days.get(dateKey);
    if (!day) { day = new Map(); days.set(dateKey, day); }
    let entry = day.get(taskId);
    if (!entry) { entry = { key: `${dateKey}:${taskId}`, taskId, dateKey, actions: [] }; day.set(taskId, entry); }
    const addSources = (location: string, before: string, after: string) => {
      const old = sources(before), next = sources(after);
      let pending = additions.get(location);
      if (!pending) { pending = new Map(); additions.set(location, pending); }
      for (const key of old.keys()) {
        if (next.has(key)) continue;
        const added = pending.get(key);
        if (added?.dateKey === dateKey) hidden.add(added.action);
        pending.delete(key);
      }
      for (const [key, target] of next) {
        if (old.has(key)) continue;
        const action: ProtocolAction = { key: `${event.id}:source:${key}`, timestamp: event.timestamp, kind: 'source', target };
        entry!.actions.push(action);
        pending.set(key, { dateKey, action });
      }
    };
    switch (event.type) {
      case 'TASK_CREATED':
        titles.set(taskId, event.payload.title);
        entry.actions.push({ key: event.id, timestamp: event.timestamp, kind: 'created' });
        break;
      case 'TASK_RENAMED': {
        const oldTitle = titles.get(taskId);
        if (oldTitle !== undefined && oldTitle !== event.payload.title) {
          entry.actions.push({ key: event.id, timestamp: event.timestamp, kind: 'renamed', oldTitle });
        }
        titles.set(taskId, event.payload.title);
        break;
      }
      case 'TASK_COMPLETED': entry.actions.push({ key: event.id, timestamp: event.timestamp, kind: 'completed' }); break;
      case 'TASK_REOPENED': entry.actions.push({ key: event.id, timestamp: event.timestamp, kind: 'reopened' }); break;
      case 'TASK_DESCRIPTION_SET':
        addSources(`description:${taskId}`, descriptions.get(taskId) ?? '', event.payload.description);
        descriptions.set(taskId, event.payload.description);
        break;
      case 'TASK_LOG_ADDED':
        entry.actions.push({ key: event.id, timestamp: event.timestamp, kind: 'log', text: event.payload.text });
        addSources(`log:${taskId}:${event.payload.entryId}`, '', event.payload.text);
        logs.set(`${taskId}:${event.payload.entryId}`, event.payload.text);
        break;
      case 'TASK_LOG_UPDATED': {
        const key = `${taskId}:${event.payload.entryId}`;
        addSources(`log:${key}`, logs.get(key) ?? '', event.payload.text);
        logs.set(key, event.payload.text);
        break;
      }
      case 'TASK_LOG_REMOVED': {
        const key = `${taskId}:${event.payload.entryId}`;
        addSources(`log:${key}`, logs.get(key) ?? '', '');
        logs.delete(key);
        break;
      }
    }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, day]) => ({
    dateKey,
    entries: [...day.values()].map(entry => ({ ...entry, actions: entry.actions.filter(action => !hidden.has(action)) })).filter(entry => entry.actions.length > 0).sort((a, b) => {
      const x = tasks[a.taskId], y = tasks[b.taskId];
      return x.topologyLevel - y.topologyLevel || x.creationOrder - y.creationOrder || x.id.localeCompare(y.id);
    }),
  })).filter(day => day.entries.length > 0);
}

export type ProtocolRow =
  | { key: string; kind: 'date'; dateKey: string }
  | { key: string; kind: 'task'; entry: ProtocolTaskEntry }
  | { key: string; kind: 'action'; entry: ProtocolTaskEntry; action: ProtocolAction };
export function protocolRows(days: readonly ProtocolDay[]): ProtocolRow[] {
  return days.flatMap(day => [
    { key: `date:${day.dateKey}`, kind: 'date' as const, dateKey: day.dateKey },
    ...day.entries.flatMap(entry => [
      { key: entry.key, kind: 'task' as const, entry },
      ...entry.actions.map(action => ({ key: `${entry.key}:${action.key}`, kind: 'action' as const, entry, action })),
    ]),
  ]);
}
