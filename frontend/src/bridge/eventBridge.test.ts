import { beforeEach, expect, it, vi } from 'vitest';
import { eventBridge, normalizeEvents } from './eventBridge';
import { dependencyPathEdges } from '../domain/dependencyPaths';
import { projectEvents } from '../domain/projector';
import { normalizeLegacyTimestamp, parseCommand } from '../domain/eventSchema';
import { StoredEvent } from '../domain/types';
import { getLanguage, setLanguage } from '../i18n';
const key = 'dodrag_sqlite_fallback_events_v1';
let storage: Map<string, string>;
beforeEach(() => {
  setLanguage('de');
  storage = new Map([[key, '[]']]);
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
const create = () => eventBridge.appendEvent('TASK_CREATED', { taskId: 't1', title: 'A', configuredStart: '2026-10-17T09:00:00Z', createdAt: '2026-10-17T09:00:00Z' });
it('loads only validated legacy browser timestamps as UTC without losing fractional precision', async () => {
  const offset = '2026-10-25T00:30:00.123456789+02:00';
  const utc = '2026-10-24T22:30:00.123456789Z';
  const legacy = [{ seq: 1, id: 'legacy', timestamp: offset, undone: false, type: 'TASK_CREATED',
    payload: { taskId: 't1', title: 'Original', createdAt: offset, configuredStart: offset } },
  { seq: 2, id: 'completed', timestamp: offset, undone: false, type: 'TASK_COMPLETED',
    payload: { taskId: 't1', completedAt: offset } }];
  expect(() => normalizeEvents(legacy)).toThrow();
  storage.set(key, JSON.stringify(legacy));
  const normalized = await eventBridge.getEvents();
  expect(normalized[0].timestamp).toBe(utc);
  expect(normalized[0].payload).toMatchObject({ createdAt: utc, configuredStart: offset, title: 'Original' });
  expect(normalized[1].payload).toMatchObject({ completedAt: utc });
  expect(JSON.parse(storage.get(key)!)).toEqual(normalized);
  expect(normalizeLegacyTimestamp('2026-01-01T00:00:00.000000001-00:30')).toBe('2026-01-01T00:30:00.000000001Z');
  expect(normalizeLegacyTimestamp('0001-01-01T00:00:00.1200+00:00')).toBe('0001-01-01T00:00:00.1200Z');
  expect(() => normalizeLegacyTimestamp('2026-02-30T00:00:00+02:00')).toThrow();
  const invalid = JSON.stringify([...legacy, { ...legacy[1], seq: 3, id: 'invalid', payload: { taskId: 'missing', completedAt: offset } }]);
  storage.set(key, invalid);
  await expect(eventBridge.getEvents()).rejects.toThrow('Unknown task');
  expect(storage.get(key)).toBe(invalid);
});

it('keeps sequence/log creation order under backward clock and prunes redo on a new append', async () => {
  try {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    await create();
    const first = await eventBridge.appendEvent('TASK_LOG_ADDED', { taskId: 't1', entryId: 'first', text: 'First', createdAt: new Date().toISOString() });
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    const next = await eventBridge.appendEvent('TASK_LOG_ADDED', { taskId: 't1', entryId: 'second', text: 'Second', createdAt: new Date().toISOString() });
    expect(next.map(event => event.seq)).toEqual([1, 2, 3]);
    expect(next[2].timestamp < next[1].timestamp).toBe(true);
    expect(projectEvents(next).tasks.t1.logEntries.map(entry => entry.id)).toEqual(['first', 'second']);
    expect(projectEvents(first).tasks.t1.logEntries.map(entry => entry.id)).toEqual(['first']);
    await eventBridge.undo();
    const pruned = await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'New branch' });
    expect(pruned.map(event => event.seq)).toEqual([1, 2, 4]);
    expect(projectEvents(pruned).canRedo).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('never reuses changed native database payloads with identical seq/id/timestamp', async () => {
  const iso = '2026-10-25T09:00:00Z';
  const raw: StoredEvent[] = [{ seq: 1, id: 'same', timestamp: iso, undone: false, type: 'TASK_CREATED',
    payload: { taskId: 't1', title: 'Database A', createdAt: iso, configuredStart: iso } }];
  const get = vi.fn(async () => JSON.parse(JSON.stringify(raw)));
  const switchDatabase = vi.fn(async () => ({ activeDatabasePath: 'B.db' }));
  vi.stubGlobal('window', { go: { main: { App: { GetEvents: get, SwitchDatabase: switchDatabase } } } });
  const first = await eventBridge.getEvents();
  await eventBridge.switchDatabase('B.db');
  raw[0] = { ...raw[0], payload: { ...raw[0].payload, title: 'Database B' } } as StoredEvent;
  const second = await eventBridge.getEvents();
  expect(projectEvents(second).tasks.t1.title).toBe('Database B');
  expect(projectEvents(first).tasks.t1.title).toBe('Database A');
  raw[0] = { ...raw[0], timestamp: 'invalid' };
  await expect(eventBridge.getEvents()).rejects.toThrow();
  expect(projectEvents(second).tasks.t1.title).toBe('Database B');
});

it('coalesces description typing and replays log addition with undo and redo', async () => {
  await create();
  await eventBridge.appendEvent('TASK_DESCRIPTION_SET', { taskId: 't1', description: '- [ ] First' }, 'description');
  const typed = await eventBridge.appendEvent('TASK_DESCRIPTION_SET', { taskId: 't1', description: '- [x] First' }, 'description');
  expect(typed).toHaveLength(2);
  expect(projectEvents(typed).tasks.t1.checklistProgress).toEqual({ checked: 1, total: 1 });
  expect(projectEvents(await eventBridge.undo()).tasks.t1.description).toBe('');
  expect(projectEvents(await eventBridge.redo()).tasks.t1.description).toBe('- [x] First');
  await eventBridge.appendEvent('TASK_LOG_ADDED', { taskId: 't1', entryId: 'log-1', text: ' Note ', createdAt: '2026-10-17T10:00:00Z' });
  expect(projectEvents(await eventBridge.undo()).tasks.t1.logEntries).toEqual([]);
  expect(projectEvents(await eventBridge.redo()).tasks.t1.logEntries[0].text).toBe('Note');
});

it('restricts URL actions and subscribes native file drops only at registered targets', async () => {
  await expect(eventBridge.openExternalURL('javascript:alert(1)')).rejects.toThrow();
  const callback = vi.fn(), onDrop = vi.fn(), off = vi.fn();
  vi.stubGlobal('window', { runtime: { OnFileDrop: onDrop, OnFileDropOff: off } });
  const unsubscribe = eventBridge.onFileDrop(callback);
  expect(onDrop).toHaveBeenCalledWith(expect.any(Function), true);
  onDrop.mock.calls[0][0](10, 20, ['C:\\file.txt']);
  expect(callback).toHaveBeenCalledWith(10, 20, ['C:\\file.txt']);
  unsubscribe();
  expect(off).toHaveBeenCalledOnce();
});

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

it('chooses and persists browser language on first start without rewriting stored titles', async () => {
  vi.stubGlobal('navigator', { languages: ['nl-NL', 'zh-Hant-HK'], language: 'nl-NL' });
  const settings = await eventBridge.getSettings();
  expect(settings.uiLanguage).toBe('zh-TW');
  expect(JSON.parse(storage.get('dodrag_settings_fallback_v1')!).uiLanguage).toBe('zh-TW');
  await create();
  const before = storage.get(key);
  await eventBridge.setUILanguage('ja');
  expect(getLanguage()).toBe('ja');
  expect(storage.get(key)).toBe(before);
  await expect(eventBridge.setUILanguage('invalid')).rejects.toThrow();
  expect(getLanguage()).toBe('ja');
  setLanguage('de');
});

it('migrates browser settings language once and uses English for unsupported preferences', async () => {
  vi.stubGlobal('navigator', { languages: ['nl-NL'], language: 'nl-NL' });
  const settingsKey = 'dodrag_settings_fallback_v1';
  storage.set(settingsKey, JSON.stringify({ knownDatabases: [{ name: 'Mein Name', path: 'A.db', exists: true, isDemo: false }], activeDatabasePath: 'A.db', autostart: false }));
  expect((await eventBridge.getSettings()).uiLanguage).toBe('en');
  vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' });
  const migrated = await eventBridge.getSettings();
  expect(migrated.uiLanguage).toBe('en');
  expect(migrated.knownDatabases[0].name).toBe('Mein Name');
  setLanguage('de');
});

it.each(['it', 'pl', 'tr'])('persists %s from browser preferences and preserves the choice across restarts', async language => {
  vi.stubGlobal('navigator', { languages: [`${language}-${language.toUpperCase()}`] });
  expect((await eventBridge.getSettings()).uiLanguage).toBe(language);
  vi.stubGlobal('navigator', { languages: ['en-US'] });
  expect((await eventBridge.getSettings()).uiLanguage).toBe(language);
  expect(getLanguage()).toBe(language);
  setLanguage('de');
});
