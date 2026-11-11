import { expect, it } from 'vitest';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';
import { projectEvents } from './projector';

it('retains explicit order through arbitrary day moves, activity, completion, reload and undo', () => {
  const now = new Date('2026-11-11T06:00:00Z');
  const events: StoredEvent[] = [];
  const add = (command: EventCommand) => events.push({ ...command, seq: events.length + 1,
    id: `event-${events.length}`, timestamp: now.toISOString(), undone: false });
  const order = () => projectEvents(JSON.parse(JSON.stringify(events)), now).openTasks.map(task => task.id);
  for (const taskId of ['C', 'A', 'B']) add({ type: 'TASK_CREATED', payload: { taskId, title: taskId,
    configuredStart: '2026-11-12T09:00:00Z', createdAt: now.toISOString() } });
  add({ type: 'TASK_REORDERED', payload: { taskId: 'C', relativeTaskId: 'B', side: 'after' } });
  expect(order()).toEqual(['A', 'B', 'C']);
  for (const taskId of ['C', 'A', 'B']) add({ type: 'TASK_START_DATE_SET', payload: { taskId, configuredStart: '2026-11-13T09:00:00Z' } });
  expect(order()).toEqual(['A', 'B', 'C']);
  add({ type: 'DEPENDENCY_ADDED', payload: { taskId: 'A', predecessorId: 'C' } });
  for (const taskId of ['C', 'A', 'B']) add({ type: 'TASK_ACTIVE_SET', payload: { taskId, isActive: true } });
  expect(order()).toEqual(['A', 'B', 'C']);
  add({ type: 'TASK_REORDERED', payload: { taskId: 'B', relativeTaskId: 'A', side: 'before' } });
  expect(order()).toEqual(['B', 'A', 'C']);
  events[events.length - 1].undone = true;
  expect(order()).toEqual(['A', 'B', 'C']);
  events[events.length - 1].undone = false;
  expect(order()).toEqual(['B', 'A', 'C']);
  add({ type: 'TASK_COMPLETED', payload: { taskId: 'A', completedAt: now.toISOString() } });
  expect(order()).toEqual(['B', 'C']);
  add({ type: 'TASK_REOPENED', payload: { taskId: 'A' } });
  add({ type: 'TASK_ACTIVE_SET', payload: { taskId: 'A', isActive: true } });
  expect(order()).toEqual(['B', 'A', 'C']);
  expect(projectEvents(events, now).tasks.A.allPredecessorIds).toEqual(['C']);
});
