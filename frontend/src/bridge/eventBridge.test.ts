import { beforeEach, expect, it, vi } from 'vitest';
import { eventBridge } from './eventBridge';
import { dependencyPathEdges } from '../domain/dependencyPaths';
import { projectEvents } from '../domain/projector';
import { parseCommand } from '../domain/eventSchema';
import { StoredEvent } from '../domain/types';
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
  expect(() => parseCommand({ type: 'TASK_ACTIVE_SET', payload: { taskId: 't1', isActive: 'false' } })).toThrow();
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
it('source-local transitive detach is one undo step and keeps the inner path edge', async () => {
  const iso='2026-10-17T09:00:00Z';
  for (const taskId of ['A','B','C']) await eventBridge.appendEvent('TASK_CREATED',{taskId,title:taskId,configuredStart:iso,createdAt:iso});
  for (const [predecessorId,taskId] of [['A','B'],['B','C'],['A','C']]) await eventBridge.appendEvent('DEPENDENCY_ADDED',{taskId,predecessorId});
  const before=await eventBridge.getEvents();
  const edges=dependencyPathEdges(projectEvents(before).tasks,'A','C');
  const after=await eventBridge.appendBatch(edges.map(edge=>({type:'DEPENDENCY_REMOVED',payload:{taskId:edge.to,predecessorId:edge.from}})));
  expect(projectEvents(after).tasks.C.allPredecessorIds).toEqual(['B']);
  expect(projectEvents(after).tasks.B.allPredecessorIds).toEqual([]);
  const undone=await eventBridge.undo();
  expect(projectEvents(undone).tasks.C.allPredecessorIds).toEqual(['B','A']);
  expect(projectEvents(undone).tasks.B.allPredecessorIds).toEqual(['A']);
});

it('groups rename and start date together, but closes groups across other edits and undo/redo', async () => {
  await create();
  await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'B' }, 'g');
  let events = await eventBridge.appendEvent('TASK_START_DATE_SET', { taskId: 't1', configuredStart: '2026-10-18T09:00:00Z' }, 'g');
  expect(events[1].groupId).toBe(events[2].groupId);
  events = await eventBridge.undo();
  expect(events.map(event => event.undone)).toEqual([false, true, true]);
  await eventBridge.redo();
  events = await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'C' }, 'g');
  expect(events[3].groupId).not.toBe(events[1].groupId);
  await eventBridge.appendEvent('TASK_ACTIVE_SET', { taskId: 't1', isActive: true }, 'other');
  events = await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'D' }, 'g');
  expect(events[5].groupId).not.toBe(events[3].groupId);
  expect(projectEvents(await eventBridge.undo()).tasks.t1.title).toBe('C');
});

it('rejects new cyclic batches atomically and preserves history on cyclic undo/redo targets', async () => {
  const iso = '2026-10-17T09:00:00Z';
  const events: StoredEvent[] = ['a', 'b'].map((taskId, i) => ({
    seq: i + 1, id: `e${i}`, timestamp: iso, undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: taskId, createdAt: iso, configuredStart: iso },
  }));
  events.push(
    { seq: 3, id: 'ab', timestamp: iso, undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
    { seq: 4, id: 'ba', timestamp: iso, undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } },
    { seq: 5, id: 'remove', timestamp: iso, undone: false, type: 'DEPENDENCY_REMOVED', payload: { taskId: 'a', predecessorId: 'b' } },
  );
  storage.set(key, JSON.stringify(events));
  const before = storage.get(key);
  expect(await eventBridge.getEvents()).toEqual(events);
  await expect(eventBridge.undo()).rejects.toThrow('cycle');
  expect(storage.get(key)).toBe(before);
  await expect(eventBridge.appendBatch([
    { type: 'TASK_RENAMED', payload: { taskId: 'a', title: 'Changed' } },
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'a', predecessorId: 'b' } },
    { type: 'DEPENDENCY_REMOVED', payload: { taskId: 'a', predecessorId: 'b' } },
  ])).rejects.toThrow('cycle');
  expect(storage.get(key)).toBe(before);
  storage.set(key, JSON.stringify(events.slice(0, 4).map(event => event.id === 'ba' ? { ...event, undone: true } : event)));
  const redoBefore = storage.get(key);
  await expect(eventBridge.redo()).rejects.toThrow('cycle');
  expect(storage.get(key)).toBe(redoBefore);
});
