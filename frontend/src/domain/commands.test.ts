import { expect, it } from 'vitest';
import { applyCommand, copyReplayTasks, replayCommands } from './commands';
import { EventCommand, parseCommand, parseStoredEvent } from './eventSchema';
import { normalizeEvents } from '../bridge/eventBridge';
import { projectEvents } from './projector';
import { StoredEvent } from './types';

const iso = '2026-10-17T09:00:00Z';
const stored = (commands: EventCommand[]): StoredEvent[] => commands.map((command, i) => ({
  ...command, seq: i + 1, id: `e${i}`, timestamp: iso, undone: false,
}));
const create = (taskId: string): EventCommand => ({
  type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: iso, createdAt: iso },
});
const transientCycle = () => stored([
  create('a'), create('b'),
  { type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
  { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } },
  { type: 'DEPENDENCY_REMOVED', payload: { taskId: 'a', predecessorId: 'b' } },
]);

it('allows historical intermediate cycles but rejects final cycles, including completed tasks', () => {
  const events = transientCycle();
  expect(replayCommands(events).tasks.get('b')!.predecessors.has('a')).toBe(true);
  expect(() => replayCommands(events.slice(0, -1))).toThrow('cycle');
  const completed = stored([
    create('a'), create('b'),
    { type: 'TASK_COMPLETED', payload: { taskId: 'a', completedAt: iso } },
    { type: 'TASK_COMPLETED', payload: { taskId: 'b', completedAt: iso } },
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } },
  ]);
  expect(() => projectEvents(completed)).toThrow('cycle');
  const tasks = copyReplayTasks(replayCommands(events));
  expect(() => applyCommand(tasks, { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } })).toThrow('cycle');
  expect(tasks.get('a')!.predecessors.size).toBe(0);
});

it.each([false, true])('replays 10k tasks in forward/reverse dependency order (reverse=%s)', reverse => {
  const commands = Array.from({ length: 10000 }, (_, i) => create(`t${i}`));
  const edges: EventCommand[] = Array.from({ length: 9999 }, (_, i) => ({
    type: 'DEPENDENCY_ADDED', payload: { taskId: `t${i + 1}`, predecessorId: `t${i}` },
  }));
  const events = stored([...commands, ...(reverse ? edges.reverse() : edges)]);
  const normalized = normalizeEvents(events);
  const state = replayCommands(normalized);
  expect(state.orderedTasks.map(task => task.id)).toEqual(commands.map(command => command.payload.taskId));
  expect(normalizeEvents(events)).toBe(normalized);
  expect(replayCommands(normalized)).toBe(state);
  const first = projectEvents(normalized, new Date(iso));
  const second = projectEvents(normalized, new Date('2027-01-01T09:00:00Z'));
  expect(first.tasks.t9999.effectiveStart).toBe(second.tasks.t9999.effectiveStart);
  expect(replayCommands(normalized)).toBe(state);
});

it('keeps schema and reference validation and does not mutate cached state for new commands', () => {
  const events = stored([create('a')]);
  const state = replayCommands(events);
  const copy = copyReplayTasks(state);
  applyCommand(copy, { type: 'TASK_RENAMED', payload: { taskId: 'a', title: 'Changed' } });
  expect(state.tasks.get('a')!.title).toBe('a');
  expect(() => replayCommands(stored([{ type: 'TASK_REOPENED', payload: { taskId: 'missing' } }]))).toThrow('Unknown task');
  expect(() => replayCommands([{ ...events[0], seq: 0 }])).toThrow();
  expect(() => replayCommands([events[0], { ...events[0], seq: 2 }])).toThrow('Duplicate');
  expect(() => parseStoredEvent({ ...events[0], groupId: 'x'.repeat(257) })).toThrow();
});

// The same persistence conformance cases are checked in Go, not the comfort parser.
const timestamps: [string, boolean][] = [
  ['2026-10-17T09:00:00Z', true],
  ['2028-02-29T23:59:59.123456789+23:59', true],
  ['0000-01-01T00:00:00Z', true],
  ['9999-12-31T23:59:59-23:59', true],
  ['2026-10-17T09:00:00-00:00', true],
  ['2026-10-17T9:00:00Z', false],
  ['2026-10-17T09:00:00,1Z', false],
  ['2026-10-17T09:00:00+24:00', false],
  ['2026-10-17T09:00:00+00:60', false],
  ['2026-10-17T24:00:00Z', false],
  ['2026-10-17T09:60:00Z', false],
  ['2026-10-17T09:00:60Z', false],
  ['2027-02-29T09:00:00Z', false],
  ['2026-04-31T09:00:00Z', false],
  ['2026-00-01T09:00:00Z', false],
  ['2026-10-17T09:00:00.1234567890Z', false],
  ['2026-10-17t09:00:00z', false],
  ['2026-10-17T09:00:00', false],
];
it.each(timestamps)('enforces persisted timestamp %s (valid=%s)', (timestamp, valid) => {
  const command = { type: 'TASK_CREATED', payload: { taskId: 'a', title: 'A', createdAt: timestamp, configuredStart: timestamp } };
  const event = { ...stored([create('a')])[0], timestamp };
  if (valid) {
    expect(() => parseCommand(command)).not.toThrow();
    expect(() => parseStoredEvent(event)).not.toThrow();
  } else {
    expect(() => parseCommand(command)).toThrow();
    expect(() => parseStoredEvent(event)).toThrow();
  }
});
