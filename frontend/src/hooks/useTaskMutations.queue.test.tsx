// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { useTaskMutations } from './useTaskMutations';
import { projectEvents, toDateKey } from '../domain/projector';
import { localDate } from '../domain/dates';
import { setLanguage } from '../i18n';
import type { EventCommand } from '../domain/eventSchema';
import type { StoredEvent } from '../domain/types';
import type { DragIdentity } from './useTaskDrag';

const bridge = vi.hoisted(() => ({ getSettings: vi.fn(), getEvents: vi.fn(), appendBatch: vi.fn(), undo: vi.fn(), redo: vi.fn() }));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: bridge }));
const now = localDate(2026, 10, 31, 12);
let host: HTMLDivElement, root: Root, history: StoredEvent[];
let database: ReturnType<typeof useDatabaseSnapshot>, actions: ReturnType<typeof useTaskMutations>;
let writes: { commands: EventCommand[]; resolve: (events: StoredEvent[]) => void; reject: (error: Error) => void }[];
let identity: { current: DragIdentity | null }, selected: string[], toast: ReturnType<typeof vi.fn>;
const task = (id = 'A') => projectEvents(database.confirmedEvents.current, now).tasks[id];
async function confirm() {
  const write = writes.shift()!;
  await act(async () => {
    history = [...history, ...write.commands.map((command, index) => ({
      ...command, seq: history.length + index + 1, id: `write-${history.length}-${index}`,
      timestamp: now.toISOString(), undone: false,
    } as StoredEvent))];
    write.resolve(history);
  });
}
beforeEach(async () => {
  vi.clearAllMocks(); setLanguage('de'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history = ['A', 'B', 'C'].map((taskId, index) => ({
    seq: index + 1, id: `create-${taskId}`, timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
    payload: { taskId, title: taskId, createdAt: now.toISOString(), configuredStart: now.toISOString() },
  }));
  writes = []; selected = []; identity = { current: null }; toast = vi.fn();
  bridge.getSettings.mockResolvedValue({ activeDatabasePath: 'A.db', knownDatabases: [], databaseReady: true, autostart: false });
  bridge.getEvents.mockResolvedValue(history);
  bridge.appendBatch.mockImplementation((commands: EventCommand[]) => new Promise<StoredEvent[]>((resolve, reject) => {
    writes.push({ commands, resolve, reject });
  }));
  function Harness() {
    database = useDatabaseSnapshot(toast, identity, vi.fn());
    actions = useTaskMutations(database, { selectedTaskIds: selected, setSelectedTaskIds: vi.fn(), setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn() },
      now, identity, vi.fn(), toast);
    return null;
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  await act(async () => { await database.loadSnapshot(); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('advances two rapid +1-day actions by two days using each confirmed FIFO state', async () => {
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = actions.handleResubmitTasks('A', 'plus_1d'); second = actions.handleResubmitTasks('A', 'plus_1d'); });
  expect(writes).toHaveLength(1);
  await confirm(); expect(await first).toBeUndefined();
  expect(writes).toHaveLength(1);
  expect(writes[0].commands[0]).toMatchObject({ payload: { configuredStart: localDate(2026, 11, 2).toISOString() } });
  await confirm(); await second;
  expect(toDateKey(new Date(task().configuredStart))).toBe('2026-11-02');
});

it('toggles twice even when both actions receive the same stale rendered task', async () => {
  const stale = task();
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = actions.handleToggleActive(stale); second = actions.handleToggleActive(stale); });
  await confirm(); await first;
  expect(writes[0].commands).toEqual([{ type: 'TASK_ACTIVE_SET', payload: { taskId: 'A', isActive: false } }]);
  await confirm(); await second; expect(task().isActive).toBe(false);
});

it('validates queued dependency changes against preceding commits without a partial cycle batch', async () => {
  identity.current = { database: 'A.db', taskId: 'A', taskIds: ['A'] };
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => {
    first = actions.handleAddPredecessor('A', 'B');
    identity.current = { database: 'A.db', taskId: 'B', taskIds: ['B', 'C'] };
    second = actions.handleAddPredecessor('B', 'A');
    identity.current = null;
  });
  await confirm(); await first; await second;
  expect(bridge.appendBatch).toHaveBeenCalledOnce();
  expect(task('A').allPredecessorIds).toEqual(['B']);
  expect(task('B').allPredecessorIds).toEqual([]); expect(task('C').allPredecessorIds).toEqual([]);
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('Zyklus'), 'warning');
});

it('keeps frozen drag members after the gesture ends while the operation waits', async () => {
  let blocker!: Promise<StoredEvent[] | null>, release!: (events: StoredEvent[]) => void, moving!: Promise<void>;
  await act(async () => {
    blocker = database.mutate(() => new Promise<StoredEvent[]>(resolve => { release = resolve; }));
    identity.current = { database: 'A.db', taskId: 'A', taskIds: ['A', 'B'] };
    moving = actions.handleResubmitTasks('A', 'plus_1d', true);
    identity.current.taskIds.push('C'); identity.current = null;
  });
  await act(async () => { release(history); await blocker; });
  expect(writes[0].commands.map(command => command.payload.taskId)).toEqual(['A', 'B']);
  await confirm(); await moving;
});

it('recomputes the next relative date after a preceding write failed', async () => {
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = actions.handleResubmitTasks('A', 'plus_1d'); second = actions.handleResubmitTasks('A', 'plus_1d'); });
  await act(async () => { writes.shift()!.reject(new Error('disk failed')); await first; });
  expect(writes[0].commands[0]).toMatchObject({ payload: { configuredStart: localDate(2026, 11, 1).toISOString() } });
  await confirm(); await second;
  expect(toDateKey(new Date(task().configuredStart))).toBe('2026-11-01');
});
