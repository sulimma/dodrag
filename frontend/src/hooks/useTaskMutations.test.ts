import { expect, it, vi } from 'vitest';
import { useTaskMutations } from './useTaskMutations';
import type { DragIdentity } from './useTaskDrag';
import { projectEvents } from '../domain/projector';
import type { StoredEvent } from '../domain/types';
import { eventBridge } from '../bridge/eventBridge';

it('toggles activity with predecessors without changing the configured date and marks the moving row', async () => {
  const now = new Date('2026-10-19T09:00:00.000Z');
  const events: StoredEvent[] = ['A', 'B'].map((taskId, i) => ({
    seq: i + 1, id: taskId, timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
    payload: { taskId, title: taskId, configuredStart: '2026-11-01T09:00:00.000Z', createdAt: now.toISOString() },
  }));
  events.push({ seq: 3, id: 'dep', timestamp: now.toISOString(), undone: false,
    type: 'DEPENDENCY_ADDED', payload: { taskId: 'B', predecessorId: 'A' } });
  const append = vi.spyOn(eventBridge, 'appendEvent').mockResolvedValue(events);
  const moved = vi.fn();
  const toast = vi.fn();
  const refresh = vi.fn();
  try {
    const state = projectEvents(events, now);
    const actions = useTaskMutations({ databaseIdentity: { current: 'A.db' }, confirmedEvents: { current: events },
      mutate: operation => operation() }, { selectedTaskIds: [], setSelectedTaskIds: vi.fn(), clearEdgeSelection: vi.fn() },
      state, now, { current: null }, moved, toast, refresh);
    await actions.handleToggleActive(state.tasks.B);
    expect(append).toHaveBeenCalledWith('TASK_ACTIVE_SET', { taskId: 'B', isActive: true });
    await actions.handleToggleActive({ ...state.tasks.B, isActive: true });
    expect(append).toHaveBeenLastCalledWith('TASK_ACTIVE_SET', { taskId: 'B', isActive: false });
    expect(moved).toHaveBeenCalledWith('task:B');
    expect(refresh).toHaveBeenCalledWith(expect.any(Date));
    expect(toast).not.toHaveBeenCalled();
  } finally { append.mockRestore(); }
});

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

it('reopens a completed task on every drop except the completed list', async () => {
  const now = new Date('2026-10-19T09:00:00.000Z');
  const events: StoredEvent[] = [
    ...['A', 'B'].map((taskId, index) => ({
      seq: index + 1, id: `task-${index}`, timestamp: now.toISOString(), undone: false,
      type: 'TASK_CREATED' as const,
      payload: { taskId, title: taskId, configuredStart: now.toISOString(), createdAt: now.toISOString() },
    })),
    {
      seq: 3, id: 'complete-B', timestamp: now.toISOString(), undone: false,
      type: 'TASK_COMPLETED', payload: { taskId: 'B', completedAt: now.toISOString() },
    },
  ];
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events);
  const types = () => append.mock.calls[0][0].map(command => command.type);
  try {
    const actions = useTaskMutations({
      databaseIdentity: { current: 'A.db' }, confirmedEvents: { current: events }, mutate: operation => operation(),
    }, {
      selectedTaskIds: [], setSelectedTaskIds: vi.fn(), clearEdgeSelection: vi.fn(),
    }, projectEvents(events, now), now, { current: { database: 'A.db', taskId: 'B', taskIds: ['B'] } }, vi.fn(), vi.fn());

    await actions.handleSetConfiguredDate('B', '2026-10-21T09:00:00.000Z', '2026-10-21', true);
    expect(types()).toEqual(['TASK_REOPENED', 'TASK_START_DATE_SET']);
    append.mockClear();

    await actions.handleAddPredecessor('B', 'A');
    expect(types()).toEqual(['TASK_REOPENED', 'DEPENDENCY_ADDED']);
    append.mockClear();

    await actions.handleResubmitTasks('B', 'plus_1d', true);
    expect(types()).toEqual(['TASK_REOPENED', 'TASK_START_DATE_SET']);
    append.mockClear();

    // Dropping onto the completed list keeps an already completed task completed.
    await actions.handleCompleteTask('B', true);
    expect(append).not.toHaveBeenCalled();
  } finally { append.mockRestore(); }
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
