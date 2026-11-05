import type { ListEntry, TaskState } from './types';
import type { ProtocolDay } from './protocol';
import { protocolActionText, protocolTime } from './protocol';
import { formatDate } from '../i18n';
import { taskLifecycleText } from './taskLog';

// One literal phrase, with flexible whitespace. Never split words into AND terms.
// No event stream enters this module: callers supply current read models only.
export function searchPattern(query: string): RegExp | null {
  if (!query) return null;
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
}

export function matchingTaskIds(tasks: Record<string, TaskState>, days: readonly ProtocolDay[], query: string): Set<string> {
  if (!query) return new Set(Object.keys(tasks));
  const pattern = searchPattern(query);
  const matches = (text: string) => { if (!pattern) return true; pattern.lastIndex = 0; return pattern.test(text); };
  const result = new Set<string>();
  for (const task of Object.values(tasks)) {
    const texts = [task.id, task.title, task.description, ...task.logEntries.flatMap(entry => [entry.text,
      formatDate(entry.createdAt), taskLifecycleText(entry)])];
    if (texts.some(matches)) result.add(task.id);
  }
  // Current notes and explicitly projected history labels (status, rename, time)
  // are searchable. Historical source additions stay visible in the protocol,
  // but removed paths/URLs cannot resurrect a match from a saved old snapshot.
  for (const day of days) for (const entry of day.entries) for (const action of entry.actions) {
    if (matches(protocolTime(action.timestamp)) || (action.kind !== 'source' && matches(protocolActionText(action)))) result.add(entry.taskId);
  }
  return result;
}

export function filterListEntries(entries: readonly ListEntry[], ids: ReadonlySet<string>): ListEntry[] {
  const result: ListEntry[] = [];
  let date: ListEntry | undefined;
  for (const entry of entries) {
    if (entry.kind === 'date') date = entry;
    else if (ids.has(entry.task.id)) {
      if (date) { result.push(date); date = undefined; }
      result.push(entry);
    }
  }
  return result;
}
export function filterProtocolDays(days: readonly ProtocolDay[], ids: ReadonlySet<string>): ProtocolDay[] {
  return days.map(day => ({ ...day, entries: day.entries.filter(entry => ids.has(entry.taskId)) })).filter(day => day.entries.length > 0);
}
