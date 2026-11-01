// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDescriptionDrafts } from './useDescriptionDrafts';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
import { projectEvents } from '../domain/projector';
import type { StoredEvent } from '../domain/types';
import type { AppSettings } from '../bridge/eventBridge';

const bridge = vi.hoisted(() => ({ getSettings: vi.fn(), getEvents: vi.fn(), appendEvent: vi.fn(), appendBatch: vi.fn(), readMarkdownFile: vi.fn() }));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: bridge }));
const date = '2026-10-25T09:00:00Z';
let root: Root, host: HTMLDivElement, history: StoredEvent[], settings: AppSettings;
let database: ReturnType<typeof useDatabaseSnapshot>, drafts: ReturnType<typeof useDescriptionDrafts>;
let writes: { text: string; taskId: string; resolve: (events: StoredEvent[]) => void; reject: (error: Error) => void }[];
let toast: ReturnType<typeof vi.fn>;
const task = (id = 'A') => projectEvents(database.confirmedEvents.current).tasks[id];
const visible = (id = 'A') => drafts.taskWithDraft(task(id))!.description;
const change = (text: string, id = 'A') => act(() => drafts.change(id, text));
async function confirm() {
  const write = writes.shift()!;
  await act(async () => {
    history = [...history, { seq: history.length + 1, id: `save-${history.length}`, timestamp: date, undone: false,
      type: 'TASK_DESCRIPTION_SET', payload: { taskId: write.taskId, description: write.text } }];
    write.resolve(history);
  });
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  settings = { activeDatabasePath: 'A.db', databaseReady: true, knownDatabases: [], autostart: false };
  history = ['A', 'B'].map((taskId, index) => ({ seq: index + 1, id: `create-${taskId}`, timestamp: date,
    undone: false, type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: date, createdAt: date } }));
  writes = []; toast = vi.fn();
  bridge.getSettings.mockImplementation(async () => settings);
  bridge.getEvents.mockImplementation(async () => history);
  bridge.appendEvent.mockImplementation((_type, payload) => new Promise<StoredEvent[]>((resolve, reject) => {
    writes.push({ text: payload.description, taskId: payload.taskId, resolve, reject });
  }));
  function Harness() {
    database = useDatabaseSnapshot(toast, { current: null }, vi.fn(), () => drafts.flushAll(), () => drafts.hasPending());
    drafts = useDescriptionDrafts(database); return null;
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  await act(async () => { await database.loadSnapshot(); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('keeps all edits local and persists one final result only at the session boundary', async () => {
  change('First'); change('Second'); change('Final');
  expect(visible()).toBe('Final'); expect(task().description).toBe('');
  expect(bridge.appendEvent).not.toHaveBeenCalled();
  let saving!: Promise<boolean>;
  await act(async () => { saving = drafts.flush('A'); });
  expect(writes.map(write => write.text)).toEqual(['Final']);
  await confirm(); expect(await saving).toBe(true);
  expect(visible()).toBe('Final'); expect(task().description).toBe('Final');
  await act(async () => { await drafts.flush('A'); });
  expect(bridge.appendEvent).toHaveBeenCalledOnce();
});

it('retains a failed draft independently of task rendering and retries the same final result', async () => {
  change('Keep this');
  let first!: Promise<boolean>;
  await act(async () => { first = drafts.flush('A'); });
  await act(async () => { writes.shift()!.reject(new Error('disk failed')); expect(await first).toBe(false); });
  expect(visible('B')).toBe(''); expect(visible('A')).toBe('Keep this');
  expect(task().description).toBe(''); expect(toast).toHaveBeenCalled();
  let retry!: Promise<boolean>;
  await act(async () => { retry = drafts.flush('A'); });
  await confirm(); expect(await retry).toBe(true); expect(task().description).toBe('Keep this');
});

it('queues a newer completed session while an older save is still pending', async () => {
  change('First session');
  let first!: Promise<boolean>, duplicate!: Promise<boolean>, second!: Promise<boolean>;
  await act(async () => { first = drafts.flush('A'); duplicate = drafts.flush('A'); });
  expect(bridge.appendEvent).toHaveBeenCalledOnce();
  change('Second session');
  await act(async () => { second = drafts.flush('A'); });
  expect(bridge.appendEvent).toHaveBeenCalledOnce();
  await confirm(); expect(await first).toBe(true); expect(await duplicate).toBe(true);
  expect(writes.map(write => write.text)).toEqual(['Second session']);
  expect(visible()).toBe('Second session');
  await confirm(); expect(await second).toBe(true); expect(task().description).toBe('Second session');
});

it('does not automatically persist typing started after a previous session ended', async () => {
  change('Finished');
  let saving!: Promise<boolean>;
  await act(async () => { saving = drafts.flush('A'); });
  change('New unfinished session'); await confirm(); expect(await saving).toBe(true);
  expect(bridge.appendEvent).toHaveBeenCalledOnce(); expect(task().description).toBe('Finished');
  expect(visible()).toBe('New unfinished session');
});

it('waits for the blur save before switching databases and never transfers a draft to the new store', async () => {
  change('Before switching');
  let save!: Promise<boolean>, switching!: Promise<AppSettings>;
  await act(async () => { save = drafts.flush('A'); });
  const switchStore = vi.fn(async () => { settings = { ...settings, activeDatabasePath: 'B.db' }; history = history.filter(event => event.type === 'TASK_CREATED'); return settings; });
  await act(async () => { switching = database.changeDatabase(switchStore); });
  expect(switchStore).not.toHaveBeenCalled(); expect(database.databaseIdentity.current).toBe('A.db');
  await confirm(); expect(await save).toBe(true);
  await act(async () => { await switching; });
  expect(switchStore).toHaveBeenCalledOnce(); expect(database.databaseIdentity.current).toBe('B.db');
  expect(visible()).toBe('');
  expect(bridge.appendEvent).toHaveBeenCalledOnce();
});

it('blocks a database switch on failed flush and keeps the original identity and draft', async () => {
  change('Do not lose');
  const switchStore = vi.fn(async () => settings);
  let failure!: Promise<unknown>;
  await act(async () => { failure = database.changeDatabase(switchStore).catch(error => error); });
  await act(async () => { writes.shift()!.reject(new Error('disk failed')); await failure; });
  expect(switchStore).not.toHaveBeenCalled(); expect(database.databaseIdentity.current).toBe('A.db');
  expect(database.snapshotReady).toBe(true); expect(visible()).toBe('Do not lose');
});


it('flushes a draft entered while the final queue drain was pending', async () => {
  let release!: (events: StoredEvent[]) => void;
  let queued!: Promise<StoredEvent[] | null>, final!: Promise<boolean>;
  await act(async () => {
    queued = database.mutate(() => new Promise<StoredEvent[]>(resolve => { release = resolve; }));
    final = drafts.flushAll();
  });
  change('Typed during drain');
  await act(async () => { release(history); await queued; });
  expect(writes.map(write => write.text)).toEqual(['Typed during drain']);
  await confirm(); expect(await final).toBe(true);
  expect(task().description).toBe('Typed during drain');
});


it('appends sources to all selected local drafts in one atomic batch', async () => {
  change('Local A', 'A'); change('Local B', 'B');
  let resolve!: (events: StoredEvent[]) => void;
  bridge.appendBatch.mockImplementation(() => new Promise<StoredEvent[]>(done => { resolve = done; }));
  let save!: Promise<boolean>;
  await act(async () => { save = drafts.appendSources(['A', 'B', 'A'], [{ kind: 'url', value: 'https://example.com/source' }]); });
  const commands = bridge.appendBatch.mock.calls[0][0];
  expect(commands).toEqual(['A', 'B'].map(taskId => ({ type: 'TASK_DESCRIPTION_SET', payload: {
    taskId, description: `Local ${taskId}\n\n<https://example.com/source>`,
  } })));
  expect(visible('A')).toContain('https://example.com/source'); expect(visible('B')).toContain('https://example.com/source');
  change(visible('A') + ' continued', 'A');
  await act(async () => {
    history = [...history, ...commands.map((command: typeof commands[number], index: number) => ({
      ...command, seq: history.length + index + 1, id: `batch-${index}`, timestamp: date, undone: false,
    }))];
    resolve(history); await save;
  });
  expect(visible('A')).toContain('continued'); expect(visible('A')).toContain('https://example.com/source');
  expect(bridge.appendBatch).toHaveBeenCalledOnce();
});

it('validates all sources before changing drafts and ignores empty or missing targets', async () => {
  const before = visible('A');
  expect(() => drafts.appendSources(['A', 'B'], [
    { kind: 'url', value: 'https://example.com/valid' },
    { kind: 'path', value: 'https://example.com/not-a-path' },
  ])).toThrow();
  expect(visible('A')).toBe(before); expect(visible('B')).toBe('');
  await act(async () => {
    expect(await drafts.appendSources(['A'], [])).toBe(true);
    expect(await drafts.appendSources(['missing'], [{ kind: 'url', value: 'https://example.com/source' }])).toBe(true);
  });
  expect(bridge.appendBatch).not.toHaveBeenCalled(); expect(bridge.appendEvent).not.toHaveBeenCalled();
});

it('appends Markdown files to current drafts in a mixed drop and preserves typing during the read', async () => {
  let resolve!: (text: string) => void;
  bridge.readMarkdownFile.mockImplementation(() => new Promise(done => { resolve = done; }));
  bridge.appendBatch.mockImplementation(async commands => {
    history = [...history, ...commands.map((command: any, index: number) => ({ ...command, seq: history.length + index + 1,
      id: `import-${index}`, timestamp: date, undone: false }))];
    return history;
  });
  change('Before');
  let saving!: Promise<boolean>;
  act(() => { saving = drafts.appendSources(['A', 'B'], [{ kind: 'path', value: 'C:\\notes.md' }, { kind: 'path', value: 'C:\\other.pdf' }]); });
  change('Typed while reading');
  await act(async () => { resolve('# Imported\n\n- [ ] Check'); expect(await saving).toBe(true); });
  expect(visible('A')).toBe('Typed while reading\n\n# Imported\n\n- [ ] Check\n\n"C:\\other.pdf"');
  expect(visible('B')).toBe('# Imported\n\n- [ ] Check\n\n"C:\\other.pdf"');
  expect(bridge.appendBatch).toHaveBeenCalledOnce();
});

it('does not partially append a mixed drop when a Markdown file read fails', async () => {
  change('Keep');
  bridge.readMarkdownFile.mockRejectedValue(new Error('Read failed'));
  await expect(drafts.appendSources(['A'], [{ kind: 'path', value: 'C:\\other.pdf' }, { kind: 'path', value: 'C:\\missing.md' }])).rejects.toThrow('Read failed');
  expect(visible()).toBe('Keep'); expect(bridge.appendBatch).not.toHaveBeenCalled();
});
