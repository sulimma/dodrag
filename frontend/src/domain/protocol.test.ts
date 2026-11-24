import { expect, it } from 'vitest';
import { projectProtocol, protocolRows } from './protocol';
import { projectEvents, toDateKey } from './projector';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';
const day = '2026-10-17T09:00:00Z', later = '2026-10-20T09:00:00Z';
const create = (taskId = 'a'): EventCommand => ({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: day, createdAt: day } });
const history = (commands: EventCommand[]): StoredEvent[] => commands.map((command, i) => ({ ...command, seq: i + 1, id: `e${i}`, timestamp: day, undone: false }));
const project = (events: StoredEvent[]) => projectProtocol(events, projectEvents(events, new Date(later)).tasks);

it('groups all edits by local day and current topology, repeats tasks across days and keeps action execution order', () => {
  const events = history([create('b'), create('a'),
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
    { type: 'TASK_COMPLETED', payload: { taskId: 'a', completedAt: day } },
    { type: 'TASK_REOPENED', payload: { taskId: 'a' } },
    { type: 'TASK_RENAMED', payload: { taskId: 'b', title: 'New' } },
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'note', text: 'A later note', createdAt: later } },
  ]);
  events[5].timestamp = later; events[6].timestamp = later;
  const days = project(events);
  expect(days.map(d => d.dateKey)).toEqual(['2026-10-17', '2026-10-20']);
  expect(days.map(d => d.entries.map(e => e.taskId))).toEqual([['a', 'b'], ['a', 'b']]);
  expect(days[0].entries[0].actions.map(a => a.kind)).toEqual(['created', 'completed', 'reopened']);
  expect(days[1].entries[1].actions).toEqual([{ key: 'e5', timestamp: later, kind: 'renamed', oldTitle: 'b' }]);
  expect(protocolRows(days).filter(row => row.kind === 'date')).toHaveLength(2);
});

it('does not create log actions or days for activation and removes undone actions until redo', () => {
  const events = history([create(), { type: 'TASK_ACTIVE_SET', payload: { taskId: 'a', isActive: true } },
    { type: 'TASK_COMPLETED', payload: { taskId: 'a', completedAt: later } }]);
  events[1].timestamp = later; events[2].timestamp = later; events[2].undone = true;
  expect(project(events).map(d => d.dateKey)).toEqual(['2026-10-17']);
  events[2] = { ...events[2], undone: false };
  expect(project(events)[1].entries[0].actions.map(a => a.kind)).toEqual(['completed']);
});

it('finds only newly added sources, preserves historical values and recognizes remove/re-add and log sources', () => {
  const events = history([create(),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '"C:\\My Project" https://example.com' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'Other words "c:\\my project\\" https://example.com' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '"C:\\My Project"' } },
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'note', text: 'See https://other.example.com', createdAt: day } },
    { type: 'TASK_LOG_UPDATED', payload: { taskId: 'a', entryId: 'note', text: 'See https://other.example.com "D:\\Work"' } },
    { type: 'TASK_LOG_REMOVED', payload: { taskId: 'a', entryId: 'note' } },
  ]);
  const actions = project(events)[0].entries[0].actions;
  expect(actions.filter(a => a.kind === 'source').map(a => a.target.value)).toEqual([
    'C:\\My Project',
  ]);
  expect(actions.find(a => a.kind === 'log')).toBeUndefined();
});

it('recomputes source differences after undo rather than comparing against undone snapshots', () => {
  const events = history([create(),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'C:\\Old' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'C:\\New' } },
  ]);
  events[1].undone = true;
  expect(project(events)[0].entries[0].actions.filter(a => a.kind === 'source').map(a => a.target.value)).toEqual(['C:\\New']);
});

it('uses local calendar days and retains old records for later filtering without filling calendar gaps', () => {
  const events = history([create(), { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'note', text: 'Old searchable note', createdAt: day } }]);
  events[0].timestamp = '1990-01-01T23:30:00Z'; events[1].timestamp = '2026-10-20T23:30:00Z';
  const days = project(events);
  expect(days.map(d => d.dateKey)).toEqual(events.map(e => toDateKey(new Date(e.timestamp))));
  expect(protocolRows(days.filter(d => d.dateKey.startsWith('1990'))).filter(r => r.kind === 'task')).toHaveLength(1);
});

it('suppresses same-day source removals, preserves later removals and restores additions on undo', () => {
  const events = history([create(),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'C:\\Temporary https://example.com/keep' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'https://example.com/keep' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '' } },
  ]);
  events[3].timestamp = later;
  const added = () => project(events).flatMap(d => d.entries.flatMap(e => e.actions)).filter(a => a.kind === 'source');
  expect(added().map(a => a.target.value)).toEqual(['https://example.com/keep']);
  expect(added()[0].timestamp).toBe(events[1].timestamp);
  events[2].undone = true;
  expect(added().map(a => a.target.value)).toEqual(['C:\\Temporary', 'https://example.com/keep']);
});

it('keeps successive former titles and rebuilds them correctly after undo', () => {
  const events = history([create(),
    { type: 'TASK_RENAMED', payload: { taskId: 'a', title: 'Second' } },
    { type: 'TASK_RENAMED', payload: { taskId: 'a', title: 'Third' } },
    { type: 'TASK_RENAMED', payload: { taskId: 'a', title: 'Third' } },
  ]);
  const names = () => project(events).flatMap(d => d.entries.flatMap(e => e.actions)).filter(a => a.kind === 'renamed').map(a => a.oldTitle);
  expect(names()).toEqual(['a', 'Second']);
  events[1].undone = true;
  expect(names()).toEqual(['a']);
});

it('omits days containing only dates, dependencies or source additions removed the same day', () => {
  const events = history([create(), create('b'),
    { type: 'TASK_START_DATE_SET', payload: { taskId: 'a', configuredStart: later } },
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } },
    { type: 'DEPENDENCY_REMOVED', payload: { taskId: 'a', predecessorId: 'b' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'C:\\Temporary' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '' } },
  ]);
  events.slice(2).forEach(event => { event.timestamp = later; });
  expect(project(events).map(d => d.dateKey)).toEqual(['2026-10-17']);
});

it('projects edited notes at their original position and removes deleted notes, including undo/redo', () => {
  const events = history([create(),
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'note', text: 'obsolete', createdAt: day } },
    { type: 'TASK_LOG_UPDATED', payload: { taskId: 'a', entryId: 'note', text: 'current' } },
    { type: 'TASK_LOG_REMOVED', payload: { taskId: 'a', entryId: 'note' } },
  ]);
  events[2].timestamp = later; events[3].timestamp = later;
  const notes = () => project(events).flatMap(d => d.entries.flatMap(e => e.actions)).filter(a => a.kind === 'log');
  expect(notes()).toEqual([]);
  events[3].undone = true;
  expect(notes()).toEqual([{ key: 'e1', timestamp: day, kind: 'log', text: 'current' }]);
  events[2].undone = true;
  expect(notes()[0]).toMatchObject({ text: 'obsolete' });
  events[2].undone = false; events[3].undone = false;
  expect(notes()).toEqual([]);
});

it('retains two sources distinguished only by filename case', () => {
  const events = history([create(),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '/docs/Plan /docs/plan' } },
  ]);
  expect(project(events)[0].entries[0].actions.filter(a => a.kind === 'source').map(a => a.target.value))
    .toEqual(['/docs/Plan', '/docs/plan']);
});
