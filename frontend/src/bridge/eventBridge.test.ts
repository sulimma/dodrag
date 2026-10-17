import { beforeEach, expect, it, vi } from 'vitest';
import { eventBridge } from './eventBridge';
const key = 'dodrag_sqlite_fallback_events_v1';
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map([[key, '[]']]);
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
const create = () => eventBridge.appendEvent('TASK_CREATED', { taskId: 't1', title: 'A', configuredStart: '2026-10-17T09:00:00Z', createdAt: '2026-10-17T09:00:00Z' });
it('rejects duplicate IDs and invalid booleans', async () => {
  await create(); await expect(create()).rejects.toThrow();
  await expect(eventBridge.appendEvent('TASK_ACTIVE_SET', { taskId: 't1', isActive: 'false' })).rejects.toThrow();
});
it('preserves corrupt data and propagates quota errors', async () => {
  storage.set(key, '{'); await expect(eventBridge.getEvents()).rejects.toThrow();
  await expect(create()).rejects.toThrow(); expect(storage.get(key)).toBe('{');
  storage.set(key, '[]'); vi.stubGlobal('localStorage', { getItem: () => '[]', setItem: () => { throw new Error('Quota'); } });
  await expect(create()).rejects.toThrow('Quota');
});
it('keeps redo and timestamps for no-ops and rolls back a batch', async () => {
  await create(); await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'B' }, 'g');
  const before = await eventBridge.undo();
  expect(await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'A' }, 'g')).toEqual(before);
  await expect(eventBridge.appendBatch([{ type: 'TASK_RENAMED', payload: { taskId: 't1', title: 'C' } }, { type: 'TASK_REOPENED', payload: { taskId: 'missing' } }])).rejects.toThrow();
  expect(await eventBridge.getEvents()).toEqual(before);
});
