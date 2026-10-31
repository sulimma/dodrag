import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { eventBridge, normalizeEvents, type AppSettings } from './eventBridge';
import type { StoredEvent } from '../domain/types';
import type { EventCommand } from '../domain/eventSchema';
import { projectEvents } from '../domain/projector';
import { getLanguage, setLanguage, t } from '../i18n';

type NativeApp = NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;
const iso = '2026-10-25T09:00:00Z';
const command: EventCommand = { type: 'TASK_CREATED', payload: {
  taskId: 't1', title: 'Original', configuredStart: iso, createdAt: iso,
} };
const history: StoredEvent[] = [{ ...command, seq: 1, id: 'created', timestamp: iso, undone: false }];
const settings: AppSettings = { knownDatabases: [], activeDatabasePath: 'A.db', databaseReady: true, autostart: false, uiLanguage: 'de' };
let api: Partial<NativeApp>;
beforeEach(() => {
  setLanguage('de');
  api = { GetEvents: vi.fn(async () => history), AppendBatch: vi.fn(async () => history),
    Undo: vi.fn(async () => history), Redo: vi.fn(async () => history), GetSettings: vi.fn(async () => settings) };
  vi.stubGlobal('window', { go: { main: { App: api } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLanguage('de'); });

it('normalizes native snapshots and preserves previous versions across database switches', async () => {
  const raw = JSON.parse(JSON.stringify(history)) as StoredEvent[];
  api.GetEvents = vi.fn(async () => JSON.parse(JSON.stringify(raw)));
  api.SwitchDatabase = vi.fn(async () => ({ ...settings, activeDatabasePath: 'B.db' }));
  const first = await eventBridge.getEvents();
  await eventBridge.switchDatabase('B.db');
  raw[0] = { ...raw[0], payload: { ...raw[0].payload, title: 'Database B' } } as StoredEvent;
  const second = await eventBridge.getEvents();
  expect(projectEvents(first).tasks.t1.title).toBe('Original');
  expect(projectEvents(second).tasks.t1.title).toBe('Database B');
  raw[0] = { ...raw[0], timestamp: 'invalid' };
  await expect(eventBridge.getEvents()).rejects.toThrow();
  expect(projectEvents(second).tasks.t1.title).toBe('Database B');
});

it('rejects malformed, non-UTC and invalid replay histories from the native boundary', () => {
  expect(() => normalizeEvents({})).toThrow(t('Event history must be an array'));
  expect(() => normalizeEvents([{ ...history[0], timestamp: '2026-10-25T11:00:00+02:00' }])).toThrow();
  expect(() => normalizeEvents([{ ...history[0], payload: { ...command.payload, createdAt: '2026-02-30T09:00:00Z' } }])).toThrow();
  expect(() => normalizeEvents([...history, { ...history[0], seq: 2 }])).toThrow();
  expect(() => normalizeEvents([{ seq: 1, id: 'unknown', timestamp: iso, undone: false,
    type: 'TASK_RENAMED', payload: { taskId: 'missing', title: 'Changed' } }])).toThrow();
});

it('sends a validated batch once and leaves grouping and atomic persistence to the native store', async () => {
  const commands: EventCommand[] = [command, { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 't1', description: 'Draft' } }];
  expect(await eventBridge.appendBatch(commands, 'edit-group')).toEqual(history);
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  const submitted = vi.mocked(api.AppendBatch!).mock.calls[0][0];
  expect(submitted).toEqual(commands.map(value => ({ ...value, groupId: 'edit-group', id: expect.any(String) })));
  expect(submitted[0].id).not.toBe(submitted[1].id);
  expect(commands).not.toHaveProperty('0.id');
  await eventBridge.appendEvent('TASK_RENAMED', { taskId: 't1', title: 'Renamed' }, 'rename');
  expect(api.AppendBatch).toHaveBeenLastCalledWith([expect.objectContaining({
    type: 'TASK_RENAMED', payload: { taskId: 't1', title: 'Renamed' }, groupId: 'rename',
  })]);
});

it('rejects invalid commands and edit groups before calling the native store', async () => {
  await expect(eventBridge.appendBatch([{ type: 'TASK_ACTIVE_SET', payload: { taskId: 't1', isActive: 'false' } } as unknown as EventCommand])).rejects.toThrow();
  await expect(eventBridge.appendBatch([command], 'x'.repeat(257))).rejects.toThrow(t('Invalid edit group'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('propagates native write failures and validates Undo/Redo responses', async () => {
  api.AppendBatch = vi.fn(async () => { throw new Error('SQLite write failed'); });
  await expect(eventBridge.appendBatch([command])).rejects.toThrow('SQLite write failed');
  expect(await eventBridge.undo()).toEqual(history);
  expect(await eventBridge.redo()).toEqual(history);
  expect(api.Undo).toHaveBeenCalledOnce(); expect(api.Redo).toHaveBeenCalledOnce();
  api.Redo = vi.fn(async () => null);
  await expect(eventBridge.redo()).rejects.toThrow(t('Event history must be an array'));
});

it('takes the UI language from native settings and updates it only after a successful native save', async () => {
  api.GetSettings = vi.fn(async () => ({ ...settings, uiLanguage: 'zh-TW' }));
  expect((await eventBridge.getSettings()).uiLanguage).toBe('zh-TW');
  expect(getLanguage()).toBe('zh-TW');
  api.SetUILanguage = vi.fn(async language => ({ ...settings, uiLanguage: language }));
  await eventBridge.setUILanguage('ja'); expect(getLanguage()).toBe('ja');
  await expect(eventBridge.setUILanguage('invalid')).rejects.toThrow();
  expect(api.SetUILanguage).toHaveBeenCalledOnce();
  api.SetUILanguage = vi.fn(async () => { throw new Error('Settings write failed'); });
  await expect(eventBridge.setUILanguage('fr')).rejects.toThrow('Settings write failed');
  expect(getLanguage()).toBe('ja');
});

const calls: Array<{ name: keyof NativeApp; invoke: () => Promise<unknown>; args: unknown[]; result?: unknown }> = [
  { name: 'SetAutostart', invoke: () => eventBridge.setAutostart(true), args: [true], result: settings },
  { name: 'RunSetupAction', invoke: () => eventBridge.runSetupAction('install'), args: ['install'], result: settings },
  { name: 'SelectFolderDialog', invoke: () => eventBridge.selectFolderDialog(), args: [], result: 'C:\\Tasks' },
  { name: 'CreateDatabase', invoke: () => eventBridge.createDatabase('C:\\Tasks', 'Work', true), args: ['C:\\Tasks', 'Work', true], result: settings },
  { name: 'OpenExistingDatabaseDialog', invoke: () => eventBridge.openExistingDatabaseDialog(), args: [], result: settings },
  { name: 'SwitchDatabase', invoke: () => eventBridge.switchDatabase('B.db'), args: ['B.db'], result: settings },
  { name: 'DeleteDatabase', invoke: () => eventBridge.deleteDatabase('B.db', true), args: ['B.db', true], result: settings },
  { name: 'OpenFolderInExplorer', invoke: () => eventBridge.openFolderInExplorer('C:\\Tasks', false), args: ['C:\\Tasks', false] },
  { name: 'OpenFolderInVSCode', invoke: () => eventBridge.openFolderInVSCode('C:\\Tasks', false), args: ['C:\\Tasks', false] },
  { name: 'OpenPathInExplorer', invoke: () => eventBridge.openPathInExplorer('C:\\Tasks'), args: ['C:\\Tasks'] },
  { name: 'OpenPathInVSCode', invoke: () => eventBridge.openPathInVSCode('C:\\Tasks'), args: ['C:\\Tasks'] },
  { name: 'OpenExternalURL', invoke: () => eventBridge.openExternalURL('https://example.com'), args: ['https://example.com'] },
  { name: 'GetPathKind', invoke: () => eventBridge.getPathKind('C:\\Tasks'), args: ['C:\\Tasks'], result: 'directory' },
  { name: 'ClearPreviewCache', invoke: () => eventBridge.clearPreviewCache(), args: [] },
  { name: 'OpenPreviewCacheInExplorer', invoke: () => eventBridge.openPreviewCacheInExplorer(), args: [] },
  { name: 'EnterMiniMode', invoke: () => eventBridge.enterMiniMode('bottom-left', 3), args: ['bottom-left', 3], result: 'bottom-left' },
  { name: 'UpdateMiniModeHeight', invoke: () => eventBridge.updateMiniModeHeight(3), args: [3] },
  { name: 'SnapMiniWindowToNearestCorner', invoke: () => eventBridge.snapMiniWindowToNearestCorner(3), args: [3], result: 'bottom-left' },
  { name: 'SetEditorReady', invoke: () => eventBridge.setEditorReady(true), args: [true] },
  { name: 'FinishClose', invoke: () => eventBridge.finishClose(false), args: [false] },
  { name: 'ExitMiniMode', invoke: () => eventBridge.exitMiniMode(), args: [] },
  { name: 'ShowTaskContextMenu', invoke: () => eventBridge.showTaskContextMenu([]), args: [[]], result: '' },
  { name: 'ShowTaskContextMenuAt', invoke: () => eventBridge.showTaskContextMenu([], { x: 20, y: 30 }), args: [[], { x: 20, y: 30 }], result: '' },
];
it.each(calls)('delegates $name to the native backend', async ({ name, invoke, args, result }) => {
  const method = vi.fn(async () => result);
  (api as Record<string, unknown>)[name] = method;
  expect(await invoke()).toEqual(result);
  expect(method).toHaveBeenCalledWith(...args);
});

it.each(calls)('rejects a missing native $name method instead of reporting success', async ({ invoke }) => {
  await expect(invoke()).rejects.toThrow(t('Anwendung konnte nicht geladen werden'));
});

it('rejects reads and mutations without a native host and never touches browser storage', async () => {
  vi.stubGlobal('window', {});
  const getItem = vi.fn(() => { throw new Error('Browser storage must not be read'); });
  const setItem = vi.fn(() => { throw new Error('Browser storage must not be written'); });
  vi.stubGlobal('localStorage', { getItem, setItem });
  for (const invoke of [() => eventBridge.getEvents(), () => eventBridge.appendBatch([command]),
    () => eventBridge.getSettings(), () => eventBridge.undo(), () => eventBridge.redo(), ...calls.map(value => value.invoke)]) {
    await expect(invoke()).rejects.toThrow(t('Anwendung konnte nicht geladen werden'));
  }
  expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
});

it('rejects unsupported URL schemes before native dispatch', async () => {
  api.OpenExternalURL = vi.fn(async () => {});
  await expect(eventBridge.openExternalURL('javascript:alert(1)')).rejects.toThrow(t('Ungültige URL'));
  expect(api.OpenExternalURL).not.toHaveBeenCalled();
});

it('shares native file-drop subscriptions and removes the native listener on the last unsubscribe', () => {
  const onDrop = vi.fn(), off = vi.fn(), first = vi.fn(), second = vi.fn();
  window.runtime = { OnFileDrop: onDrop, OnFileDropOff: off };
  const removeFirst = eventBridge.onFileDrop(first), removeSecond = eventBridge.onFileDrop(second);
  let firstActive = true;
  try {
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(expect.any(Function), true);
    onDrop.mock.calls[0][0](10, 20, ['C:\\file.txt']);
    expect(first).toHaveBeenCalledWith(10, 20, ['C:\\file.txt']);
    expect(second).toHaveBeenCalledWith(10, 20, ['C:\\file.txt']);
    removeFirst(); firstActive = false; expect(off).not.toHaveBeenCalled();
  } finally { if (firstActive) removeFirst(); removeSecond(); }
  expect(off).toHaveBeenCalledOnce();
});
