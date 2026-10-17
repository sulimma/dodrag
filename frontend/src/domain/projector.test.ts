import { describe, expect, it } from 'vitest';
import {
  computeDependencyHighlights,
  computeMiniWindowTasks,
  computeTransitiveReductionEdges,
  projectEvents,
  toDateKey,
} from './projector';
import { StoredEvent } from './types';

describe('DoDrag Event-Sourcing Projector & Topological Sort', () => {
  const fixedNow = new Date('2026-10-16T10:00:00.000Z');
  const todayIso = '2026-10-16T09:00:00.000Z';

  it('computes calculatedStart as 1 day after the latest effectiveStart of predecessors', () => {
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
    expect(taskB.calculatedStart).not.toBeNull();
    expect(toDateKey(new Date(taskB.calculatedStart!))).toBe('2026-10-17');
    expect(taskB.effectiveDateKey).toBe('2026-10-17');
    expect(taskB.isWaitingOrFuture).toBe(true);
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
    expect(state.tasks['26-10'].isWaitingOrFuture).toBe(false);
  });

  it('places newly created tasks at the top and maintains stable order of unaffected tasks', () => {
    const baseEvents: StoredEvent[] = [
      {
        seq: 1,
        id: 'e1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'Alpha', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'e2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'Beta', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'e3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'Gamma', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: 'e4',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-4', title: 'Delta', configuredStart: todayIso },
        undone: false,
      },
    ];

    const initial = projectEvents(baseEvents, fixedNow);
    const initialTaskOrder = initial.listEntries
      .filter((e) => e.kind === 'task')
      .map((e) => (e.kind === 'task' ? e.task.id : ''));
    // Newest task ('26-4') is at the very top
    expect(initialTaskOrder).toEqual(['26-4', '26-3', '26-2', '26-1']);

    // Now move 26-2 to depend on 26-4; 26-4, 26-3, 26-1 must keep their exact relative order ['26-4', '26-3', '26-1']
    const updated = projectEvents(
      [
        ...baseEvents,
        {
          seq: 5,
          id: 'e5',
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

    expect(unaffectedOrder).toEqual(['26-4', '26-3', '26-1']);
  });

  it('highlights ONLY true graph predecessors and successors, ignoring unrelated tasks earlier or later in the list', () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        id: 'u1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-0', title: 'Unbeteiligter Task ganz oben', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: '1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'T1', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'u2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-99', title: 'Unbeteiligter Task dazwischen', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 4,
        id: '2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'T2', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 5,
        id: '3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'T3', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 6,
        id: '4',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-4', title: 'T4', configuredStart: todayIso },
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
        payload: { taskId: '26-1', title: 'A', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: '2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'B', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 3,
        id: '3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-3', title: 'C', configuredStart: todayIso },
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
        payload: { taskId: '26-50', title: 'Freitag Task', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'w2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-51', title: 'Samstag Task', configuredStart: satIso },
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

    // Case 1: Today has tasks without predecessors -> only today's startable tasks are returned (active first)
    const eventsWithToday: StoredEvent[] = [
      {
        seq: 1,
        id: 'm1',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-1', title: 'Heute Startbar Normal', configuredStart: todayIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'm2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-2', title: 'Heute Aktiv', configuredStart: todayIso },
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
        payload: { taskId: '26-3', title: 'Morgen ohne Vorgänger', configuredStart: tomorrowIso },
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
        payload: { taskId: '26-10', title: 'Morgen ohne Vorgänger', configuredStart: tomorrowIso },
        undone: false,
      },
      {
        seq: 2,
        id: 'f2',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-11', title: 'Nächste Woche ohne Vorgänger', configuredStart: nextWeekIso },
        undone: false,
      },
      {
        seq: 3,
        id: 'f3',
        timestamp: todayIso,
        type: 'TASK_CREATED',
        payload: { taskId: '26-12', title: 'Blockierter Task', configuredStart: tomorrowIso },
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
  });
});

it('projects a deep chain and distant legacy dates without daily materialization', () => {
  const iso='2026-10-17T09:00:00Z';
  const events: StoredEvent[] = [];
  for (let i=9999;i>=0;i--) events.push({seq:events.length+1,id:`e${i}`,timestamp:iso,type:'TASK_CREATED',payload:{taskId:`t${i}`,title:'Task',configuredStart:iso,createdAt:iso},undone:false});
  for (let i=9999;i>0;i--) events.push({seq:events.length+1,id:`d${i}`,timestamp:iso,type:'DEPENDENCY_ADDED',payload:{taskId:`t${i}`,predecessorId:`t${i-1}`},undone:false});
  const projected=projectEvents(events,new Date(iso));
  expect(projected.openTasks[0].id).toBe('t0'); expect(projected.openTasks[9999].id).toBe('t9999');
  const future=[{...events[0],payload:{...events[0].payload,configuredStart:'9999-01-01T09:00:00Z'}}];
  expect(projectEvents(future,new Date(iso)).listEntries.length).toBe(3);
  expect(projectEvents(future,new Date('2026-10-18T09:00:00Z')).tasks['t9999'].configuredStart).toBe('9999-01-01T09:00:00Z');
});
