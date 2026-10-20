import { expect, it, vi } from 'vitest';
import { useTaskMutations } from './useTaskMutations';
import type { DragIdentity } from './useTaskDrag';
import { projectEvents } from '../domain/projector';
import type { StoredEvent } from '../domain/types';
import { eventBridge } from '../bridge/eventBridge';

it('guards every group drop with the frozen database and source identity', async () => {
  const now = new Date('2026-10-19T09:00:00.000Z');
  const events: StoredEvent[] = ['A', 'B', 'C'].map((taskId, index) => ({
    seq: index + 1, id: `task-${index}`, timestamp: now.toISOString(), undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: now.toISOString(), createdAt: now.toISOString() },
  }));
  const database = { databaseIdentity: { current: 'B.db' }, confirmedEvents: { current: events }, mutate: vi.fn() };
  const identity: { current: DragIdentity | null } = { current: { database: 'A.db', taskId: 'A', taskIds: ['A', 'B'] } };
  const actions = useTaskMutations(database, {
    selectedTaskIds: ['C'], setSelectedTaskIds: vi.fn(), clearEdgeSelection: vi.fn(),
  }, projectEvents(events, now), now, identity, vi.fn(), vi.fn());
  const drops = async (source: string) => {
    await actions.handleSetConfiguredDate(source, '2026-10-21T09:00:00.000Z', '2026-10-21', true);
    await actions.handleResubmitTasks(source, 'plus_1d', true);
    await actions.handleCompleteTask(source, true);
    await actions.handleAddPredecessor(source, 'C');
    await actions.handleRemoveDependencyBetween(source, 'C');
  };
  await drops('A');
  expect(database.mutate).not.toHaveBeenCalled();
  database.databaseIdentity.current = 'A.db';
  await drops('B');
  expect(database.mutate).not.toHaveBeenCalled();
  identity.current = null;
  await drops('A');
  expect(database.mutate).not.toHaveBeenCalled();
});

it('uses frozen group members for date drops even after selection changes', async () => {
  const now = new Date('2026-10-19T09:00:00.000Z');
  const events: StoredEvent[] = ['A', 'B', 'C'].map((taskId, index) => ({
    seq: index + 1, id: `task-${index}`, timestamp: now.toISOString(), undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: now.toISOString(), createdAt: now.toISOString() },
  }));
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events);
  try {
    const actions = useTaskMutations({ databaseIdentity: { current: 'A.db' }, confirmedEvents: { current: events }, mutate: operation => operation() }, {
      selectedTaskIds: ['C'], setSelectedTaskIds: vi.fn(), clearEdgeSelection: vi.fn(),
    }, projectEvents(events, now), now, { current: { database: 'A.db', taskId: 'A', taskIds: ['A', 'B'] } }, vi.fn(), vi.fn());
    await actions.handleSetConfiguredDate('A', '2026-10-21T09:00:00.000Z', '2026-10-21', true);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].map(command => command.payload.taskId)).toEqual(['A', 'B']);
  } finally { append.mockRestore(); }
});
