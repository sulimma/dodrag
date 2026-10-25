import { afterEach, expect, it, vi } from 'vitest';
import { replayCommands } from './commands';
import * as schema from './eventSchema';
import { normalizeEvents } from '../bridge/eventBridge';
import { projectEvents } from './projector';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';

const iso = '2026-10-25T09:00:00Z';
const create = (taskId: string): EventCommand => ({
  type: 'TASK_CREATED', payload: { taskId, title: taskId, createdAt: iso, configuredStart: iso },
});
const event = (command: EventCommand, seq: number): StoredEvent => ({ ...command, seq, id: `e${seq}`, timestamp: iso, undone: false });
const rename = (title: string): EventCommand => ({ type: 'TASK_RENAMED', payload: { taskId: 'a', title } });
const transport = (events: readonly StoredEvent[]): StoredEvent[] => JSON.parse(JSON.stringify(events));
afterEach(() => vi.restoreAllMocks());

it('reuses validated native JSON strings with Go key order and parses only the appended event', () => {
  const raw = ['a', 'b'].map((taskId, index) => ({
    ...event(create(taskId), index + 1),
    payload: JSON.stringify({ configuredStart: iso, createdAt: iso, taskId, title: taskId }),
  }));
  const initial = normalizeEvents(raw);
  expect(raw[0].payload).not.toBe(JSON.stringify(initial[0].payload));
  const old = replayCommands(initial);
  const parse = vi.spyOn(schema, 'parseStoredEvent');
  const appended = { ...event(rename('native edit'), 3), payload: JSON.stringify({ taskId: 'a', title: 'native edit' }) };
  const next = normalizeEvents([...raw.map(item => ({ ...item })), appended]);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(next[0]).toBe(initial[0]);
  expect(next[1]).toBe(initial[1]);
  expect(replayCommands(next).tasks.get('b')).toBe(old.tasks.get('b'));
  expect(replayCommands(next).tasks.get('a')!.title).toBe('native edit');
  expect(old.tasks.get('a')!.title).toBe('a');
  parse.mockClear();
  expect(normalizeEvents(transport(next))).toBe(next);
  expect(normalizeEvents(next.map(item => ({ ...item, payload: JSON.stringify(item.payload) })))).toBe(next);
  expect(parse).not.toHaveBeenCalled();

  const changed = [...raw.map(item => ({ ...item })), appended];
  changed[0].payload = JSON.stringify({ configuredStart: iso, createdAt: iso, taskId: 'a', title: 'other database' });
  const switched = normalizeEvents(changed);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(switched[0]).not.toBe(initial[0]);
  expect(switched[0].payload).toMatchObject({ title: 'other database' });
  parse.mockClear();
  const invalid = changed.map(item => ({ ...item }));
  invalid[0].payload = JSON.stringify({ configuredStart: iso, createdAt: iso, taskId: 'a', title: 'other database', extra: true });
  expect(() => normalizeEvents(invalid)).toThrow();
  expect(parse).toHaveBeenCalledTimes(1);
  parse.mockClear();
  expect(normalizeEvents(changed)).toBe(switched);
  expect(parse).not.toHaveBeenCalled();
});

it('parses only appended events across full transports and copies only affected tasks', () => {
  const raw = [event(create('a'), 1), event(create('b'), 2)];
  const initial = normalizeEvents(raw);
  const old = replayCommands(initial);
  const parse = vi.spyOn(schema, 'parseStoredEvent');
  const next = normalizeEvents([...transport(initial), event(rename('changed'), 3)]);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(next[0]).toBe(initial[0]);
  expect(next[1]).toBe(initial[1]);
  const updated = replayCommands(next);
  expect(updated.tasks.get('a')).not.toBe(old.tasks.get('a'));
  expect(updated.tasks.get('b')).toBe(old.tasks.get('b'));
  expect(updated.orderedTasks[0]).toBe(updated.tasks.get('a'));
  expect(updated.activeEventCount).toBe(3);
  expect(old.tasks.get('a')!.title).toBe('a');
  expect(replayCommands(initial)).toBe(old);
  expect(Object.isFrozen(next)).toBe(true);
  expect(Object.isFrozen(next[0].payload)).toBe(true);
});

it('replays latest coalescing from the affected task prefix, including non-invertible active edits', () => {
  const base = normalizeEvents([event(create('a'), 1), event(create('b'), 2),
    event({ type: 'TASK_ACTIVE_SET', payload: { taskId: 'a', isActive: true } }, 3)]);
  const before = replayCommands(base);
  const parse = vi.spyOn(schema, 'parseStoredEvent');
  const replaced = transport(base);
  replaced[2] = { ...replaced[2], type: 'TASK_ACTIVE_SET', payload: { taskId: 'a', isActive: false } };
  const normalized = normalizeEvents(replaced);
  expect(parse).toHaveBeenCalledTimes(1);
  expect(replayCommands(normalized).tasks.get('a')!.isActive).toBe(false);
  expect(replayCommands(normalized).tasks.get('b')).toBe(before.tasks.get('b'));
  expect(before.tasks.get('a')!.isActive).toBe(true);
  expect(replayCommands(normalized).activeEventCount).toBe(3);
  const again = transport(normalized);
  again[2] = { ...again[2], type: 'TASK_ACTIVE_SET', payload: { taskId: 'a', isActive: true } };
  expect(replayCommands(normalizeEvents(again)).tasks.get('a')!.isActive).toBe(true);
});

it('handles undo/redo/pruning and changed prefix/payload/group without stale replay reuse', () => {
  const raw = [event(create('a'), 1), event(rename('B'), 2), event(rename('C'), 3)];
  const old = replayCommands(normalizeEvents(raw));
  const undone = transport(raw).map(item => item.seq === 3 ? { ...item, undone: true } : item);
  const undo = replayCommands(normalizeEvents(undone));
  expect(undo.tasks.get('a')!.title).toBe('B');
  expect(undo.canRedo).toBe(true);
  expect(replayCommands(normalizeEvents(transport(raw))).tasks.get('a')!.title).toBe('C');
  normalizeEvents(undone);
  const pruned = [...undone.slice(0, 2), event(rename('D'), 4)];
  expect(replayCommands(normalizeEvents(pruned))).toMatchObject({ canRedo: false, activeEventCount: 3 });
  const changed = transport(raw);
  changed[1] = event(rename('prefix-changed'), 2);
  changed[2] = { ...changed[2], undone: true, groupId: 'new-group' };
  const normalized = normalizeEvents(changed);
  expect(normalized[1].payload).toEqual(changed[1].payload);
  expect(normalized[2].groupId).toBe('new-group');
  expect(replayCommands(normalized).tasks.get('a')!.title).toBe('prefix-changed');
  expect(old.tasks.get('a')!.title).toBe('C');
});

it('verifies changed external arrays and old invalid events without poisoning the prior cache', () => {
  const raw = [event(create('a'), 1), event(rename('B'), 2)];
  const normalized = normalizeEvents(raw);
  const before = replayCommands(normalized);
  raw[0].payload = { ...create('a').payload, title: 'external' } as typeof raw[0]['payload'];
  expect(normalizeEvents(raw)[0].payload).toMatchObject({ title: 'external' });
  const bad = transport(normalized);
  bad[0].payload = { ...create('a').payload, createdAt: '2026-10-25T09:00:00+02:00' } as typeof bad[0]['payload'];
  expect(() => normalizeEvents([...bad, event(rename('C'), 3)])).toThrow();
  const extra = transport(normalized) as unknown as Array<{ payload: Record<string, unknown> }>;
  extra[0].payload.extra = true;
  expect(() => normalizeEvents(extra)).toThrow();
  const duplicate = [...transport(normalized), { ...event(rename('C'), 3), id: normalized[0].id }];
  expect(() => normalizeEvents(duplicate)).toThrow('Duplicate');
  expect(() => normalizeEvents([...transport(normalized), event(rename('partially applied'), 3),
    event({ type: 'TASK_REOPENED', payload: { taskId: 'missing' } }, 4)])).toThrow('Unknown task');
  expect(replayCommands(normalized)).toBe(before);
  expect(before.tasks.get('a')!.title).toBe('B');
  const valid = normalizeEvents([...transport(normalized), event(rename('C'), 3)]);
  expect(replayCommands(valid).tasks.get('a')!.title).toBe('C');
});

it('keeps old log entries and predecessor sets detached when appending mutable collections', () => {
  const base = normalizeEvents([event(create('a'), 1), event(create('b'), 2),
    event({ type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'first', text: 'First', createdAt: iso } }, 3)]);
  const old = replayCommands(base);
  const next = normalizeEvents([...transport(base),
    event({ type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'second', text: 'Second', createdAt: iso } }, 4),
    event({ type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } }, 5)]);
  expect(old.tasks.get('a')!.logEntries.map(entry => entry.id)).toEqual(['first']);
  expect(old.tasks.get('a')!.predecessors.size).toBe(0);
  expect(replayCommands(next).tasks.get('a')!.logEntries.map(entry => entry.id)).toEqual(['first', 'second']);
  expect(replayCommands(next).tasks.get('a')!.predecessors.has('b')).toBe(true);
});

it('updates cached topological order for dependency appends and permits only final acyclic histories', () => {
  const base = normalizeEvents([event(create('a'), 1), event(create('b'), 2)]);
  const dependency: EventCommand = { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } };
  const next = normalizeEvents([...transport(base), event(dependency, 3)]);
  expect(replayCommands(next).orderedTasks.map(task => task.id)).toEqual(['b', 'a']);
  expect(projectEvents(next, new Date(iso)).tasks.a.predecessorIds).toEqual(['b']);
  const cycle: EventCommand = { type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } };
  expect(() => normalizeEvents([...transport(next), event(cycle, 4)])).toThrow('cycle');
  const fixed = normalizeEvents([...transport(next), event(cycle, 4),
    event({ type: 'DEPENDENCY_REMOVED', payload: { taskId: 'b', predecessorId: 'a' } }, 5)]);
  expect(replayCommands(fixed).orderedTasks.map(task => task.id)).toEqual(['b', 'a']);
  expect(replayCommands(base).tasks.get('a')!.predecessors.size).toBe(0);
});
