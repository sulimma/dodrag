import { expect, it } from 'vitest';
import { searchPattern, matchingTaskIds, filterListEntries, filterProtocolDays } from './search';
import { projectEvents } from './projector';
import { projectProtocol, protocolTime } from './protocol';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';
const date = '2026-10-17T09:00:00Z';
const create = (taskId: string, title = taskId): EventCommand => ({ type: 'TASK_CREATED', payload: { taskId, title, configuredStart: date, createdAt: date } });
function fixture(commands: EventCommand[]) {
  const events: StoredEvent[] = commands.map((command, i) => ({ ...command, seq: i + 1, id: `e${i}`, timestamp: i > 1 ? '2026-10-20T09:00:00Z' : date, undone: false }));
  const state = projectEvents(events, new Date(date));
  const days = projectProtocol(events, state.tasks);
  return { events, state, days, matches: (query: string) => [...matchingTaskIds(state.tasks, days, query)] };
}
it('matches a literal case-insensitive phrase with flexible whitespace, including newlines', () => {
  for (const symbol of ['?', '.', '+', '(', ')', '[', ']', '{', '}', '$', '^', '*', '|', '\\']) {
    expect(searchPattern(symbol)!.test(`literal ${symbol} text`)).toBe(true);
  }
  expect(searchPattern('Alpha   BETA')!.test('ALPHA\t \r\nbeta')).toBe(true);
  expect(searchPattern('Alpha beta')!.test('alpha intervening beta')).toBe(false);
  expect(searchPattern('a.b')!.test('axb')).toBe(false);
  expect(searchPattern('')).toBeNull();
});
it('searches current IDs, titles, Markdown/checklists and current notes across completed and open tasks', () => {
  const f = fixture([create('26-101', 'Title'), create('26-102'),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: '26-101', description: '- [ ] Deep\n    phrase (literal?)' } },
    { type: 'TASK_LOG_ADDED', payload: { taskId: '26-102', entryId: 'note', text: 'tel:+49123 C:\\Work https://example.com', createdAt: date } },
    { type: 'TASK_COMPLETED', payload: { taskId: '26-102', completedAt: date } },
  ]);
  for (const q of ['26-101', 'TITLE', 'deep phrase', '(literal?)']) expect(f.matches(q)).toEqual(['26-101']);
  for (const q of ['tel:+49123', 'C:\\Work', 'https://example.com']) expect(f.matches(q)).toEqual(['26-102']);
  expect(new Set(f.matches(''))).toEqual(new Set(['26-101', '26-102']));
});
it('never resurrects overwritten descriptions, edited or removed notes, or historical source snapshots', () => {
  const f = fixture([create('a'), create('b'),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'ObsoleteDescription https://removed.example' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'CurrentDescription' } },
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'n', text: 'ObsoleteNote', createdAt: date } },
    { type: 'TASK_LOG_UPDATED', payload: { taskId: 'a', entryId: 'n', text: 'CurrentNote' } },
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'b', entryId: 'n', text: 'DeletedNote', createdAt: date } },
    { type: 'TASK_LOG_REMOVED', payload: { taskId: 'b', entryId: 'n' } },
  ]);
  for (const q of ['ObsoleteDescription', 'removed.example', 'ObsoleteNote', 'DeletedNote']) expect(f.matches(q)).toEqual([]);
  for (const q of ['CurrentDescription', 'CurrentNote']) expect(f.matches(q)).toEqual(['a']);
});
it('keeps matching task blocks across all projected days and removes empty date groups', () => {
  const f = fixture([create('a'), create('b'),
    { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'n', text: 'needle', createdAt: date } },
  ]);
  const ids = matchingTaskIds(f.state.tasks, f.days, 'needle');
  expect(filterProtocolDays(f.days, ids).map(day => day.entries.map(entry => entry.taskId))).toEqual([['a'], ['a']]);
  expect(filterListEntries(f.state.listEntries, ids).filter(entry => entry.kind === 'task').map(entry => entry.task.id)).toEqual(['a']);
  expect(filterListEntries(f.state.listEntries, new Set())).toEqual([]);
  expect(filterProtocolDays(f.days, new Set())).toEqual([]);
});

it('matches the displayed time of a projected source action', () => {
  const f = fixture([create('a'), create('b'),
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: 'https://example.com' } },
  ]);
  f.events[2].timestamp = '2026-10-20T14:37:00Z';
  const days = projectProtocol(f.events, f.state.tasks);
  expect([...matchingTaskIds(f.state.tasks, days, protocolTime(f.events[2].timestamp))]).toEqual(['a']);
});
