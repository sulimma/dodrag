import { commandTaskId } from '../domain/eventSchema';
import { expect, it, vi } from 'vitest';
import { useTaskMutations } from './useTaskMutations';
import type { DragIdentity } from './useTaskDrag';
import { calculateQuickResubmitDate, toDateKey, projectEvents } from '../domain/projector';
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
  const confirmed = { current: events };
  const append = vi.spyOn(eventBridge, 'appendBatch').mockImplementation(async commands => {
    confirmed.current = [...confirmed.current, ...commands.map((command, index) => ({
      ...command, seq: confirmed.current.length + index + 1, id: `active-${confirmed.current.length}-${index}`,
      timestamp: now.toISOString(), undone: false,
    } as StoredEvent))];
    return confirmed.current;
  });
  const moved = vi.fn();
  const toast = vi.fn();
  const refresh = vi.fn();
  try {
    const state = projectEvents(events, now);
    const actions = useTaskMutations({ databaseIdentity: { current: 'A.db' }, confirmedEvents: confirmed,
      mutate: operation => operation() }, { selectedTaskIds: [], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn() },
      now, { current: null }, moved, toast, refresh);
    await actions.handleToggleActive(state.tasks.B);
    expect(append).toHaveBeenCalledWith([{ type: 'TASK_ACTIVE_SET', payload: { taskId: 'B', isActive: true } }]);
    await actions.handleToggleActive({ ...state.tasks.B, isActive: true });
    expect(append).toHaveBeenLastCalledWith([{ type: 'TASK_ACTIVE_SET', payload: { taskId: 'B', isActive: false } }]);
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
    selectedTaskIds: ['C'], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn(),
  }, now, identity, vi.fn(), vi.fn());
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
      selectedTaskIds: [], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn(),
    }, now, { current: { database: 'A.db', taskId: 'B', taskIds: ['B'] } }, vi.fn(), vi.fn());

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
      selectedTaskIds: ['C'], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn(),
    }, now, { current: { database: 'A.db', taskId: 'A', taskIds: ['A', 'B'] } }, vi.fn(), vi.fn());
    await actions.handleSetConfiguredDate('A', '2026-10-21T09:00:00.000Z', '2026-10-21', true);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].map(command => commandTaskId(command))).toEqual(['A', 'B']);
  } finally { append.mockRestore(); }
});

it('preserves the full ISO instant supplied by a date drop', async () => {
  const now = new Date('2026-10-19T09:00:00.000Z');
  const events: StoredEvent[] = [{ seq: 1, id: 'A', timestamp: now.toISOString(), undone: false,
    type: 'TASK_CREATED', payload: { taskId: 'A', title: 'A', configuredStart: now.toISOString(), createdAt: now.toISOString() } }];
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events);
  try {
    const actions = useTaskMutations({ databaseIdentity: { current: 'db' }, confirmedEvents: { current: events }, mutate: operation => operation() },
      { selectedTaskIds: [], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn() }, now, { current: null }, vi.fn(), vi.fn());
    await actions.handleSetConfiguredDate('A', '2026-12-31T23:30:12.000Z', '2026-12-31');
    expect(append).toHaveBeenCalledWith([{ type: 'TASK_START_DATE_SET', payload: { taskId: 'A', configuredStart: '2026-12-31T23:30:12.000Z' } }]);
  } finally { append.mockRestore(); }
});

it.each(['date', 'same-date', 'plus_1d', 'next_week', 'plus_7d', 'next_month', 'predecessor', 'complete'] as const)(
  'ends activity for a grouped %s move and allows future tasks to be activated again', async target => {
    const now = new Date('2026-10-19T09:00:00.000Z');
    const future = '2026-12-01T09:00:00.000Z';
    const confirmed = { current: ['A', 'B', 'C'].map((taskId, index): StoredEvent => ({
      seq: index + 1, id: taskId, timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
      payload: { taskId, title: taskId, configuredStart: future, createdAt: now.toISOString() },
    })) };
    const append = vi.spyOn(eventBridge, 'appendBatch').mockImplementation(async commands => {
      confirmed.current = [...confirmed.current, ...commands.map((command, index): StoredEvent => ({
        ...command, seq: confirmed.current.length + index + 1, id: `event-${confirmed.current.length}-${index}`,
        timestamp: now.toISOString(), undone: false,
      }))];
      return confirmed.current;
    });
    const state = () => projectEvents(confirmed.current, now);
    const actions = useTaskMutations({ databaseIdentity: { current: 'db' }, confirmedEvents: confirmed,
      mutate: operation => operation() }, { selectedTaskIds: [], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn() },
      now, { current: { database: 'db', taskId: 'A', taskIds: ['A', 'B'] } }, vi.fn(), vi.fn());
    try {
      for (const id of ['A', 'B']) await actions.handleToggleActive(state().tasks[id]);
      const beforeMove = state();
      expect(beforeMove.tasks.A.effectiveDateKey).toBe(toDateKey(now));
      append.mockClear();
      const date = target === 'same-date' ? future : '2026-11-02T09:00:00.000Z';
      if (target === 'date' || target === 'same-date') await actions.handleSetConfiguredDate('A', date, date, true);
      else if (target === 'predecessor') await actions.handleAddPredecessor('A', 'C');
      else if (target === 'complete') await actions.handleCompleteTask('A', true);
      else await actions.handleResubmitTasks('A', target, true);
      expect(append).toHaveBeenCalledTimes(1);
      for (const id of ['A', 'B']) {
        expect(state().tasks[id].isActive).toBe(false);
        if (target === 'complete') {
          expect(state().tasks[id].completed).toBe(true);
          await actions.handleReopenTask(id);
          expect(state().tasks[id].isActive).toBe(false);
        } else {
          const expected = target === 'date' || target === 'same-date' ? date : target === 'predecessor' ? future
            : calculateQuickResubmitDate(target, beforeMove.tasks[id]);
          expect(state().tasks[id].configuredStart).toBe(expected);
          expect(state().tasks[id].effectiveDateKey > toDateKey(now)).toBe(true);
        }
        const configuredStart = state().tasks[id].configuredStart;
        await actions.handleToggleActive(state().tasks[id]);
        expect(state().tasks[id]).toMatchObject({ isActive: true, configuredStart, effectiveDateKey: toDateKey(now) });
      }
      expect(state().tasks.C).toMatchObject({ isActive: false, configuredStart: future });
    } finally { append.mockRestore(); }
  }
);
it('does not reorder selected members against an anchor inside the dragged group', async () => {
 const now = new Date('2026-11-11T09:00:00Z');
 const events: StoredEvent[] = ['A', 'B', 'C'].map((taskId, index) => ({
   seq: index + 1, id: `create-${taskId}`, timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
   payload: { taskId, title: taskId, configuredStart: now.toISOString(), createdAt: now.toISOString() },
 }));
 const mutate = vi.fn(async operation => operation());
 const actions = useTaskMutations({ databaseIdentity: { current: 'A.db' }, confirmedEvents: { current: events }, mutate },
   { selectedTaskIds: ['A', 'B', 'C'], setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn() },
   now, { current: { database: 'A.db', taskId: 'A', taskIds: ['A', 'B', 'C'] } }, vi.fn(), vi.fn());
 await actions.handleInsertTask('A', 'B', 'before');
 expect(mutate).not.toHaveBeenCalled();
});
