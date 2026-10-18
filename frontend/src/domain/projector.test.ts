import { describe, expect, it } from 'vitest';
import {
  computeDependencyHighlights,
  computeMiniWindowTasks,
  computeTransitiveReductionEdges,
  projectEvents,
  toDateKey,
} from './projector';
import { StoredEvent } from './types';
import { localDate } from './dates';

describe('DoDrag Event-Sourcing Projector & Date Sort', () => {
  const fixedNow = new Date('2026-10-16T10:00:00.000Z');
  const todayIso = '2026-10-16T09:00:00.000Z';

  it('adds one calendar day to the latest computed predecessor before taking the maximum with the own date', () => {
    const dates = {
      a: '2026-10-18T14:30:12.000Z',
      b: '2026-10-17T18:00:00.000Z',
      c: todayIso,
      d: todayIso,
      e: '2026-10-22T08:00:00.000Z',
    };
    const events: StoredEvent[] = Object.entries(dates).map(([taskId, configuredStart], i) => ({
      seq: i + 1, id: `e${i}`, timestamp: todayIso, undone: false, type: 'TASK_CREATED',
      payload: { taskId, title: taskId, configuredStart, createdAt: todayIso },
    }));
    for (const [taskId, predecessorId] of [['c', 'a'], ['c', 'b'], ['d', 'c'], ['e', 'd']]) {
      events.push({ seq: events.length + 1, id: `e${events.length}`, timestamp: todayIso,
        undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId, predecessorId } });
    }
    const before = projectEvents(events, fixedNow);
    const after = projectEvents([...events, {
      seq: events.length + 1, id: 'completed', timestamp: todayIso, undone: false,
      type: 'TASK_COMPLETED', payload: { taskId: 'a', completedAt: todayIso },
    }], fixedNow);
    for (const state of [before, after]) {
      expect(state.tasks.c.effectiveStart).toBe('2026-10-19T14:30:12.000Z');
      expect(state.tasks.d.effectiveStart).toBe('2026-10-20T14:30:12.000Z');
      expect(state.tasks.e.calculatedStart).toBe('2026-10-21T14:30:12.000Z');
      expect(state.tasks.e.effectiveStart).toBe(dates.e);
    }
    expect(after.tasks.c.predecessorIds).toEqual(['b']);
  });

  it('sorts full timestamps then IDs, including overdue, active and completed tasks', () => {
    const dates = [
      ['26-108', '2026-10-17T18:41:31+02:00'],
      ['26-104', '2026-10-17T14:39:31+02:00'],
      ['26-103', '2026-10-17T12:39:31Z'],
      ['26-102', '2026-10-16T23:00:00Z'],
      ['26-101', '2026-10-15T23:00:00Z'],
    ];
    const events: StoredEvent[] = dates.map(([taskId, configuredStart], i) => ({
      seq: i + 1, id: `e${i}`, timestamp: todayIso, undone: false, type: 'TASK_CREATED',
      payload: { taskId, title: taskId, configuredStart, createdAt: todayIso },
    }));
    events.push({ seq: 6, id: 'active', timestamp: todayIso, undone: false,
      type: 'TASK_ACTIVE_SET', payload: { taskId: '26-108', isActive: true } });
    const now = new Date('2026-10-18T12:00:00Z');
    const state = projectEvents(events, now);
    const expected = ['26-101', '26-102', '26-103', '26-104', '26-108'];
    expect(state.openTasks.map(t => t.id)).toEqual(expected);
    expect(state.listEntries.flatMap(e => e.kind === 'task' ? [e.task.id] : [])).toEqual(expected);
    expect(computeMiniWindowTasks([...state.openTasks].reverse(), now).map(t => t.id)).toEqual([
      '26-108', '26-101', '26-102', '26-103', '26-104',
    ]);
    const multipleActive = projectEvents([...events, {
      seq: 7, id: 'active2', timestamp: todayIso, undone: false,
      type: 'TASK_ACTIVE_SET', payload: { taskId: '26-104', isActive: true },
    }], now);
    expect(computeMiniWindowTasks([...multipleActive.openTasks].reverse(), now).map(t => t.id)).toEqual([
      '26-104', '26-108', '26-101', '26-102', '26-103',
    ]);
    const completed = projectEvents([...events, ...expected.map((taskId, i): StoredEvent => ({
      seq: 7 + i, id: `done${i}`, timestamp: todayIso, undone: false,
      type: 'TASK_COMPLETED', payload: { taskId, completedAt: `2026-10-18T12:00:0${i}Z` },
    }))], now);
    expect(completed.completedTasks.map(t => t.id)).toEqual(expected);
  });

  it('preserves local time when adding a calendar day across DST and year boundaries', () => {
    for (const [year, month, day] of [[2027, 3, 27], [2027, 10, 30], [2026, 12, 31]]) {
      const start = localDate(year, month, day, 14, 30, 12).toISOString();
      const expected = localDate(year, month, day + 1, 14, 30, 12).toISOString();
      const state = projectEvents([
        { seq: 1, id: 'a', timestamp: start, undone: false, type: 'TASK_CREATED', payload: { taskId: 'a', title: 'A', configuredStart: start, createdAt: start } },
        { seq: 2, id: 'b', timestamp: start, undone: false, type: 'TASK_CREATED', payload: { taskId: 'b', title: 'B', configuredStart: start, createdAt: start } },
        { seq: 3, id: 'dep', timestamp: start, undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
      ], new Date(start));
      expect(state.tasks.b.effectiveStart).toBe(expected);
    }
  });

  it('adds one day to the predecessor timestamp', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: 'e1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: {
          taskId: '26-1',
          title: 'Task A (Vorgänger)',
          configuredStart: todayIso,
          createdAt: todayIso,
        },
        undone: false,
      },
      {
        seq: 2,
        id: 'e2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: {
          taskId: '26-2',
          title: 'Task B (Nachfolger)',
          configuredStart: todayIso,
          createdAt: todayIso,
        },
        undone: false,
      },
      {
        seq: 3,
        id: 'e3',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: {
          taskId: '26-2',
          predecessorId: '26-1',
        },
        undone: false,
      },
    ];

    const state = projectEvents(events, fixedNow);
    const taskA = state.tasks['26-1'];
    const taskB = state.tasks['26-2'];

    expect(taskA.calculatedStart).toBeNull();
    expect(taskA.effectiveStart).toBe(todayIso);
    expect(taskB.calculatedStart).toBe('2026-10-17T09:00:00.000Z');
    expect(taskB.effectiveStart).toBe(taskB.calculatedStart);
    expect(taskB.effectiveDateKey).toBe(toDateKey(new Date(taskB.effectiveStart)));
    expect(taskB.isDeemphasized).toBe(true);
  });

  it('always displays Today as the first date entry and collapses subsequent consecutive empty dates', () => {
    const futureDayIso = '2026-10-20T09:00:00.000Z';
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: 'e1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: {
          taskId: '26-10',
          title: 'Erst in 4 Tagen starten',
          configuredStart: futureDayIso,
          createdAt: todayIso,
        },
        undone: false,
      },
    ];

    const state = projectEvents(events, fixedNow);
    // Today (2026-10-16) is always visible first so tasks can be dragged onto Today
    expect(state.listEntries[0].kind).toBe('date');
    if (state.listEntries[0].kind === 'date') {
      expect(state.listEntries[0].dateKey).toBe('2026-10-16');
      expect(state.listEntries[0].isToday).toBe(true);
    }
    // Consecutive dates after Today (17, 18, 19, 20) collapse into 2026-10-20
    expect(state.listEntries[1].kind).toBe('date');
    if (state.listEntries[1].kind === 'date') {
      expect(state.listEntries[1].dateKey).toBe('2026-10-20');
      expect(state.listEntries[1].collapsedCount).toBe(3);
    }
    expect(state.listEntries[2].kind).toBe('task');
    // Since Today has no tasks, the task in the first non-empty day (2026-10-20) is displayed like Today's tasks (not faded)
    expect(state.tasks['26-10'].isDeemphasized).toBe(false);
  });

  it('breaks timestamp ties by ID regardless of creation order or dependencies', () => {
    const baseEvents: StoredEvent[] = [
      {
        seq: 1,
        id: 'e1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'Alpha', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'e2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'Beta', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'e3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'Gamma', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: 'e4',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-4', title: 'Delta', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
    ];

    const initial = projectEvents(baseEvents, fixedNow);
    const initialTaskOrder = initial.listEntries
      .filter((e) => e.kind === 'task')
      .map((e) => (e.kind === 'task' ? e.task.id : ''));
    expect(initialTaskOrder).toEqual(['26-1', '26-2', '26-3', '26-4']);

    // Equal dates remain ID-sorted even when the successor ID precedes its predecessor.
    const updated = projectEvents(
      [
        ...baseEvents,
        {
          seq: 5,
          id: 'e5',
          timestamp: todayIso,
          type: 'TASK_START_DATE_SET',
          payload: { taskId: '26-4', configuredStart: '2026-10-15T09:00:00.000Z' },
          undone: false,
        },
        {
          seq: 6,
          id: 'e6',
          timestamp: todayIso,
          type: 'DEPENDENCY_ADDED',
          payload: { taskId: '26-2', predecessorId: '26-4' },
          undone: false,
        },
      ],
      fixedNow
    );

    const unaffectedOrder = updated.listEntries
      .filter((e) => e.kind === 'task')
      .map((e) => (e.kind === 'task' ? e.task.id : ''))
      .filter((id) => id !== '26-2');

    expect(unaffectedOrder).toEqual(['26-4', '26-1', '26-3']);
    expect(updated.openTasks.map(t => t.id)).toEqual(['26-4', '26-1', '26-2', '26-3']);
    expect(updated.listEntries.flatMap(e => e.kind === 'task' ? [e.task.id] : [])).toEqual(['26-4', '26-1', '26-2', '26-3']);
  });

  it('highlights ONLY true graph predecessors and successors, ignoring unrelated tasks earlier or later in the list', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: 'u1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-0', title: 'Unbeteiligter Task ganz oben', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: '1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'T1', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'u2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-99', title: 'Unbeteiligter Task dazwischen', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: '2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'T2', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 5,
        id: '3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'T3', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 6,
        id: '4',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-4', title: 'T4', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 7,
        id: '5',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-2', predecessorId: '26-1' },
        undone: false,
      },
      {
        seq: 8,
        id: '6',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-3', predecessorId: '26-2' },
        undone: false,
      },
      {
        seq: 9,
        id: '7',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-4', predecessorId: '26-3' },
        undone: false,
      },
    ];

    const state = projectEvents(events, fixedNow);
    const highlights = computeDependencyHighlights('26-3', state.tasks);

    expect(highlights['26-3']).toBe('selected');
    expect(highlights['26-2']).toBe('predecessor-direct');
    expect(highlights['26-1']).toBe('predecessor-transitive');
    expect(highlights['26-4']).toBe('successor-direct');
    expect(highlights['26-0']).toBeUndefined();
    expect(highlights['26-99']).toBeUndefined();
  });

  it('hides transitive edges in the network graph (A->B, B->C, and A->C omits A->C)', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: '1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'A', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: '2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'B', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: '3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'C', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: '4',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-2', predecessorId: '26-1' }, // A -> B
        undone: false,
      },
      {
        seq: 5,
        id: '5',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-3', predecessorId: '26-2' }, // B -> C
        undone: false,
      },
      {
        seq: 6,
        id: '6',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-3', predecessorId: '26-1' }, // A -> C (redundant transitive edge)
        undone: false,
      },
    ];

    const state = projectEvents(events, fixedNow);
    const reducedEdges = computeTransitiveReductionEdges(state.openTasks);

    expect(reducedEdges).toEqual(
      expect.arrayContaining([
        { from: '26-1', to: '26-2' },
        { from: '26-2', to: '26-3' },
      ])
    );
    expect(reducedEdges).not.toContainEqual({ from: '26-1', to: '26-3' });
  });

  it('uses ISO-8601 date formatting and flags weekends (Saturday/Sunday)', () => {
    const satIso = '2026-10-17T09:00:00.000Z';
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: 'w1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-50', title: 'Freitag Task', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'w2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-51', title: 'Samstag Task', configuredStart: satIso, createdAt: todayIso },
        undone: false,
      },
    ];

    const state = projectEvents(events, fixedNow);
    const dateEntries = state.listEntries.filter(
      (e): e is Extract<typeof e, { kind: 'date' }> => e.kind === 'date'
    );

    const friEntry = dateEntries.find((d) => d.dateKey === '2026-10-16');
    const satEntry = dateEntries.find((d) => d.dateKey === '2026-10-17');

    expect(friEntry).toBeDefined();
    expect(friEntry!.isWeekend).toBe(false);
    expect(friEntry!.label).toContain('2026-10-16');

    expect(satEntry).toBeDefined();
    expect(satEntry!.isWeekend).toBe(true);
    expect(satEntry!.label).toContain('2026-10-17');
  });

  it('computes mini window tasks: only today tasks without predecessors, or all tasks without predecessors if today has none', () => {
    const tomorrowIso = '2026-10-17T09:00:00.000Z';
    const nextWeekIso = '2026-10-20T09:00:00.000Z';

    // Case 1: Today has tasks without predecessors -> active first, then timestamp/ID order.
    const eventsWithToday: StoredEvent[] = [
      {
        seq: 1,
        id: 'm1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'Heute Startbar Normal', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'm2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'Heute Aktiv', configuredStart: todayIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'm3',
        timestamp: todayIso,
        type: 'TASK_ACTIVE_SET',
        payload: { taskId: '26-2', isActive: true },
        undone: false,
      },
      {
        seq: 4,
        id: 'm4',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'Morgen ohne Vorgänger', configuredStart: tomorrowIso, createdAt: todayIso },
        undone: false,
      },
    ];

    const state1 = projectEvents(eventsWithToday, fixedNow);
    const mini1 = computeMiniWindowTasks(state1.openTasks, fixedNow);
    expect(mini1.map((t) => t.id)).toEqual(['26-2', '26-1']);

    // Case 2: Today has NO tasks -> all tasks without predecessors across future days are returned
    const eventsWithoutToday: StoredEvent[] = [
      {
        seq: 1,
        id: 'f1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-10', title: 'Morgen ohne Vorgänger', configuredStart: tomorrowIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'f2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-11', title: 'Nächste Woche ohne Vorgänger', configuredStart: nextWeekIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'f3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-12', title: 'Blockierter Task', configuredStart: tomorrowIso, createdAt: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: 'f4',
        timestamp: todayIso,
        type: 'DEPENDENCY_ADDED',
        payload: { taskId: '26-12', predecessorId: '26-10' },
        undone: false,
      },
    ];

    const state2 = projectEvents(eventsWithoutToday, fixedNow);
    const mini2 = computeMiniWindowTasks(state2.openTasks, fixedNow);
    expect(mini2.map((t) => t.id)).toEqual(['26-10', '26-11']);
    const activeFuture = projectEvents([...eventsWithoutToday, {
      seq: 5, id: 'f5', timestamp: todayIso, undone: false,
      type: 'TASK_ACTIVE_SET', payload: { taskId: '26-11', isActive: true },
    }], fixedNow);
    expect(computeMiniWindowTasks(activeFuture.openTasks, fixedNow).map(t => t.id)).toEqual(['26-11', '26-10']);
  });
});

it('projects a deep chain and distant legacy dates without daily materialization', () => {
  const iso='2026-10-17T09:00:00Z';
  const events: StoredEvent[] = [];
  for (let i=9999;i>=0;i--) events.push({seq:events.length+1,id:`e${i}`,timestamp:iso,type:'TASK_CREATED',payload:{taskId:`t${i}`,title:'Task',configuredStart:iso,createdAt:iso},undone:false});
  for (let i=9999;i>0;i--) events.push({seq:events.length+1,id:`d${i}`,timestamp:iso,type:'DEPENDENCY_ADDED',payload:{taskId:`t${i}`,predecessorId:`t${i-1}`},undone:false});
  const projected=projectEvents(events,new Date(iso));
  expect(projected.openTasks[0].id).toBe('t0'); expect(projected.openTasks[9999].id).toBe('t9999');
  const future: StoredEvent[] = [{ seq: 1, id: 'future', timestamp: iso, undone: false, type: 'TASK_CREATED', payload: { taskId: 't9999', title: 'Future', createdAt: iso, configuredStart: '9999-01-01T09:00:00Z' } }];
  expect(projectEvents(future,new Date(iso)).listEntries.length).toBe(3);
  expect(projectEvents(future,new Date('2026-10-18T09:00:00Z')).tasks['t9999'].configuredStart).toBe('9999-01-01T09:00:00Z');
});
