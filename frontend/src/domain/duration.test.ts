import { expect, it } from 'vitest';
import { parseCommand, type EventCommand } from './eventSchema';
import { projectEvents } from './projector';
import { addDuration, progressRatio } from './duration';
import { localDate } from './dates';
import type { StoredEvent } from './types';

const now = new Date('2026-11-02T09:00:00Z');
const iso = now.toISOString();
const create = (taskId: string, configuredStart = iso): EventCommand => ({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart, createdAt: iso } });
const dep = (taskId: string, predecessorId: string): EventCommand => ({ type: 'DEPENDENCY_ADDED', payload: { taskId, predecessorId } });
const timing = (taskId: string, duration: number, progress: number | null, durationUnit: 'minutes' | 'hours' | 'days' = 'days'): EventCommand => ({ type: 'TASK_TIMING_SET', payload: { taskId, duration, progress, durationUnit } });
const stored = (commands: EventCommand[]): StoredEvent[] => commands.map((command, i) => ({ ...command, seq: i + 1, id: `event-${i}`, timestamp: iso, undone: false }));

it('keeps old histories at one day and propagates the latest finish, including fractional units and zero remaining work', () => {
  const commands = [create('a'), create('b', '2026-11-03T09:00:00Z'), create('c'), create('d'), dep('c', 'a'), dep('c', 'b'), dep('d', 'c')];
  expect(projectEvents(stored(commands), now).tasks.a).toMatchObject({ duration: 1, durationUnit: 'days', progress: null });
  commands.push(timing('a', 5, 2), timing('b', 30, null, 'minutes'), timing('c', 2.5, 1, 'hours'));
  const state = projectEvents(stored(commands), now);
  expect(state.tasks.c.calculatedStart).toBe('2026-11-05T09:00:00.000Z');
  expect(state.tasks.d.calculatedStart).toBe('2026-11-05T10:30:00.000Z');
  commands.push(timing('a', 5, 5));
  expect(projectEvents(stored(commands), now).tasks.c.calculatedStart).toBe('2026-11-03T09:30:00.000Z');
  commands.push({ type: 'TASK_COMPLETED', payload: { taskId: 'b', completedAt: iso } });
  expect(projectEvents(stored(commands), now).tasks.c.calculatedStart).toBe(iso);
});

it('recalculates on progress edits, clearing, undo, redo and activation without changing configured dates', () => {
  const events = stored([create('a', '2026-11-06T09:00:00Z'), create('b'), dep('b', 'a'), timing('a', 4, 2)]);
  expect(projectEvents(events, now).tasks.b.calculatedStart).toBe('2026-11-08T09:00:00.000Z');
  const edit = stored([timing('a', 4, null)]).map(event => ({ ...event, seq: 5, id: 'clear' }));
  expect(projectEvents([...events, ...edit], now).tasks.b.calculatedStart).toBe('2026-11-10T09:00:00.000Z');
  expect(projectEvents([...events, ...edit.map(event => ({ ...event, undone: true }))], now).tasks.b.calculatedStart).toBe('2026-11-08T09:00:00.000Z');
  expect(projectEvents([...events, ...edit], now).tasks.a.progress).toBeNull();
  const active: StoredEvent = { type: 'TASK_ACTIVE_SET', payload: { taskId: 'a', isActive: true }, seq: 5, id: 'active', timestamp: iso, undone: false };
  expect(projectEvents([...events, active], now).tasks.b.calculatedStart).toBe('2026-11-04T09:00:00.000Z');
  const overdue = stored([create('a', '2026-10-01T09:00:00Z'), create('b'), dep('b', 'a'), timing('a', 90, 30, 'minutes')]);
  expect(projectEvents(overdue, now).tasks.b.calculatedStart).toBe('2026-11-02T10:00:00.000Z');
});

it('uses explicit progress including zero before checklists; checklists do not shorten dependency duration', () => {
  const events = stored([create('a'), create('b'), dep('b', 'a'), { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '- [x] done\n- [ ] open' } }]);
  const checklist = projectEvents(events, now).tasks.a;
  expect(progressRatio(checklist)).toBe(0.5);
  expect(progressRatio({ ...checklist, progress: 0 })).toBe(0);
  expect(progressRatio({ ...checklist, progress: 3, duration: 5 })).toBe(0.6);
  expect(progressRatio({ ...checklist, checklistProgress: null })).toBeNull();
  expect(projectEvents(events, now).tasks.b.calculatedStart).toBe(addDuration(iso, 1, 'days'));
});

it('preserves local calendar days across DST and treats hours as elapsed time', () => {
  for (const month of [3, 10]) {
    const day = month === 3 ? 27 : 30;
    const start = localDate(2027, month, day, 12).toISOString();
    expect(addDuration(start, 1, 'days')).toBe(localDate(2027, month, day + 1, 12).toISOString());
    expect(Date.parse(addDuration(start, 24, 'hours')) - Date.parse(start)).toBe(86400000);
  }
});

it.each([
  { duration: 0 }, { duration: -1 }, { duration: Infinity }, { duration: NaN },
  { progress: -1 }, { progress: 6 }, { progress: NaN }, { progress: '' },
  { durationUnit: 'weeks' }, { duration: 36501 },
])('rejects invalid timing at the event boundary: %j', patch => {
  expect(() => parseCommand({ type: 'TASK_TIMING_SET', payload: { taskId: 'a', duration: 5, durationUnit: 'days', progress: null, ...patch } })).toThrow();
});
