// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import type { DragIdentity } from './useTaskDrag';
import type { AppSettings } from '../bridge/eventBridge';
import type { StoredEvent } from '../domain/types';
import { t } from '../i18n';

const bridge = vi.hoisted(() => ({ getSettings: vi.fn(), getEvents: vi.fn() }));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: bridge }));
const settings: AppSettings = {
  activeDatabasePath: 'C:\\fixture.db', knownDatabases: [], autostart: false, databaseReady: true,
};
const snapshot = (seq: number): StoredEvent[] => [{
  seq, id: `event-${seq}`, timestamp: '2026-10-25T10:00:00Z', undone: false,
  type: 'TASK_DESCRIPTION_SET', payload: { taskId: '26-101', description: `Draft ${seq}` },
}];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let host: HTMLDivElement, root: Root, hook: ReturnType<typeof useDatabaseSnapshot>;
let toast: ReturnType<typeof vi.fn>, invalidate: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  bridge.getSettings.mockResolvedValue(settings); bridge.getEvents.mockResolvedValue([]);
  toast = vi.fn(); invalidate = vi.fn();
  const drag = { current: null } as React.MutableRefObject<DragIdentity | null>;
  function Harness() { hook = useDatabaseSnapshot(toast, drag, invalidate); return null; }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Harness />));
  await act(async () => { await hook.loadSnapshot(); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('runs two parallel deferred writes FIFO without dropping either snapshot', async () => {
  const first = deferred<StoredEvent[]>(), second = deferred<StoredEvent[]>();
  const order: string[] = [];
  const write1 = vi.fn(() => { order.push('first'); return first.promise; });
  const write2 = vi.fn(() => { order.push('second'); return second.promise; });
  let result1!: Promise<StoredEvent[] | null>, result2!: Promise<StoredEvent[] | null>;
  await act(async () => { result1 = hook.mutate(write1); result2 = hook.mutate(write2); });
  expect(order).toEqual(['first']); expect(write2).not.toHaveBeenCalled();
  expect(hook.mutationBusy.current).toBe(true); expect(hook.events).toEqual([]);
  const firstSnapshot = snapshot(1), secondSnapshot = snapshot(2);
  await act(async () => { first.resolve(firstSnapshot); expect(await result1).toBe(firstSnapshot); });
  expect(order).toEqual(['first', 'second']);
  expect(hook.events).toBe(firstSnapshot); expect(hook.confirmedEvents.current).toBe(firstSnapshot);
  expect(hook.mutationBusy.current).toBe(true);
  await act(async () => { second.resolve(secondSnapshot); expect(await result2).toBe(secondSnapshot); });
  expect(write1).toHaveBeenCalledOnce(); expect(write2).toHaveBeenCalledOnce();
  expect(hook.events).toBe(secondSnapshot); expect(hook.confirmedEvents.current).toBe(secondSnapshot);
  expect(hook.mutationBusy.current).toBe(false); expect(toast).not.toHaveBeenCalled();
});

it('blocks changing databases throughout active and queued writes without invalidating the snapshot', async () => {
  const first = deferred<StoredEvent[]>(), second = deferred<StoredEvent[]>();
  let result1!: Promise<StoredEvent[] | null>, result2!: Promise<StoredEvent[] | null>;
  // Admission must block synchronously, before the first queued operation even starts.
  act(() => { result1 = hook.mutate(() => first.promise); result2 = hook.mutate(() => second.promise); });
  const change = vi.fn(async () => ({ ...settings, activeDatabasePath: 'C:\\other.db' }));
  await expect(hook.changeDatabase(change)).rejects.toThrow(t('Eine Aenderung wird noch gespeichert'));
  expect(change).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  expect(hook.snapshotReady).toBe(true); expect(hook.databaseIdentity.current).toBe(settings.activeDatabasePath);
  await act(async () => { first.resolve(snapshot(1)); await result1; });
  await expect(hook.changeDatabase(change)).rejects.toThrow(t('Eine Aenderung wird noch gespeichert'));
  expect(change).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  await act(async () => { second.resolve(snapshot(2)); await result2; });
  const nextSettings = { ...settings, activeDatabasePath: 'C:\\other.db' };
  bridge.getSettings.mockResolvedValue(nextSettings); bridge.getEvents.mockResolvedValue([]);
  await act(async () => { expect(await hook.changeDatabase(change)).toEqual(nextSettings); });
  expect(change).toHaveBeenCalledOnce(); expect(invalidate).toHaveBeenCalledOnce();
  expect(hook.databaseIdentity.current).toBe(nextSettings.activeDatabasePath);
  expect(hook.events).toEqual([]); expect(hook.snapshotReady).toBe(true);
  expect(hook.mutationBusy.current).toBe(false);
});

it('releases the FIFO queue after a rejected write and commits the next operation', async () => {
  const first = deferred<StoredEvent[]>(), second = deferred<StoredEvent[]>();
  const write2 = vi.fn(() => second.promise);
  let result1!: Promise<StoredEvent[] | null>, result2!: Promise<StoredEvent[] | null>;
  await act(async () => { result1 = hook.mutate(() => first.promise); result2 = hook.mutate(write2); });
  await act(async () => { first.reject(new Error('Write fixture failure')); expect(await result1).toBeNull(); });
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('Write fixture failure'), 'warning');
  expect(write2).toHaveBeenCalledOnce(); expect(hook.mutationBusy.current).toBe(true);
  expect(hook.confirmedEvents.current).toEqual([]);
  const updated = snapshot(2);
  await act(async () => { second.resolve(updated); expect(await result2).toBe(updated); });
  expect(hook.events).toBe(updated); expect(hook.mutationBusy.current).toBe(false);
});
