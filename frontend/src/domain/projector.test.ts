import { describe, expect, it } from 'vitest';
import {
  computeDependencyHighlights,
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

  it('collapses consecutive empty date entries so only the latest date entry is displayed', () => {
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
    // There are no tasks on 2026-10-16, 17, 18, 19 -> all consecutive dates before 2026-10-20 must collapse into 2026-10-20!
    expect(state.listEntries[0].kind).toBe('date');
    if (state.listEntries[0].kind === 'date') {
      expect(state.listEntries[0].dateKey).toBe('2026-10-20');
      expect(state.listEntries[0].collapsedCount).toBeGreaterThan(0);
    }
    expect(state.listEntries[1].kind).toBe('task');
  });

  it('maintains stable order of unaffected tasks when another task is modified', () => {
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
    expect(initialTaskOrder).toEqual(['26-1', '26-2', '26-3', '26-4']);

    // Now move 26-2 to depend on 26-4; 26-1, 26-3, 26-4 must keep their relative order ['26-1', '26-3', '26-4']
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

    expect(unaffectedOrder).toEqual(['26-1', '26-3', '26-4']);
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
    // Unrelated tasks earlier in the list must NOT be highlighted!
    expect(highlights['26-0']).toBeUndefined();
    expect(highlights['26-99']).toBeUndefined();
  });

  it('uses ISO-8601 date formatting and flags weekends (Saturday/Sunday)', () => {
    // 2026-10-16 is Friday, 2026-10-17 is Saturday (Weekend), 2026-10-18 is Sunday (Weekend)
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
});
