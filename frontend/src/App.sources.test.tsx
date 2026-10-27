// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AppSettings } from './bridge/eventBridge';
import type { StoredEvent } from './domain/types';
import type { EditorTarget } from './components/editor/types';
import { setLanguage, t } from './i18n';

const details = vi.hoisted(() => ({ create: undefined as ((source: EditorTarget) => void) | undefined }));
vi.mock('./components/TaskDetailPanel', () => ({
  TaskDetailPanel: ({ onCreateSourceTask }: { onCreateSourceTask?: (source: EditorTarget) => void }) => {
    details.create = onCreateSourceTask; return null;
  },
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ initial, animate, exit, ...props }: any) => <div {...props} /> },
}));
const date = '2026-10-26T09:00:00.000Z';
const history: StoredEvent[] = [{
  seq: 1, id: 'fixture', timestamp: date, undone: false, type: 'TASK_CREATED',
  payload: { taskId: '26-101', title: 'Alpha', configuredStart: date, createdAt: date },
}];
const source: EditorTarget = { kind: 'url', value: 'https://example.com/source' };
let host: HTMLDivElement, root: Root;
let api: NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;
let settings: AppSettings;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  setLanguage('de'); details.create = undefined;
  settings = { activeDatabasePath: 'A.db', databaseReady: true, autostart: false,
    knownDatabases: ['A', 'B'].map(name => ({ name, path: `${name}.db`, exists: true, isDemo: false })) };
  api = {
    GetSettings: vi.fn(async () => settings), GetEvents: vi.fn(async () => history),
    AppendBatch: vi.fn(async () => history), AppendEvent: vi.fn(async () => history),
    Undo: vi.fn(async () => history), Redo: vi.fn(async () => history),
    SwitchDatabase: vi.fn(async path => { settings = { ...settings, activeDatabasePath: path }; return settings; }),
    DeleteDatabase: vi.fn(async () => settings), CreateDatabase: vi.fn(async () => settings),
    OpenExistingDatabaseDialog: vi.fn(async () => settings), SetAutostart: vi.fn(async () => settings),
    SelectFolderDialog: vi.fn(async () => ''), EnterMiniMode: vi.fn(async () => ''), ExitMiniMode: vi.fn(async () => {}),
    ShowTaskContextMenu: vi.fn(async () => ''), UpdateMiniModeHeight: vi.fn(async () => {}),
    SnapMiniWindowToNearestCorner: vi.fn(async () => ''),
  };
  window.go = { main: { App: api } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); delete window.go; delete window.runtime;
  setLanguage('de'); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const creation = () => host.querySelector<HTMLInputElement>('header form input')!;
const type = (value: string) => act(() => {
  const input = creation();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = async () => { await act(async () => creation().form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
const click = async (target: Element) => { await act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
const textButton = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent === text)!;

it('focuses task creation without creating immediately, then atomically creates the task with its source', async () => {
  await act(async () => root.render(<App />));
  act(() => details.create!(source));
  expect(document.activeElement).toBe(creation()); expect(api.AppendBatch).not.toHaveBeenCalled();
  type('Task for source'); await submit();
  const commands = vi.mocked(api.AppendBatch).mock.calls[0][0];
  expect(commands).toEqual([
    expect.objectContaining({ type: 'TASK_CREATED', payload: expect.objectContaining({ title: 'Task for source' }) }),
    expect.objectContaining({ type: 'TASK_DESCRIPTION_SET', payload: {
      taskId: commands[0].payload.taskId, description: '<https://example.com/source>',
    } }),
  ]);
  expect(api.AppendBatch).toHaveBeenCalledOnce(); expect(api.AppendEvent).not.toHaveBeenCalled();
  expect(creation().value).toBe('');
  type('Ordinary next task'); await submit();
  expect(vi.mocked(api.AppendBatch).mock.calls[1][0].map(command => command.type)).toEqual(['TASK_CREATED']);
});

it('retains the source and title after a failed creation for an atomic retry', async () => {
  await act(async () => root.render(<App />)); act(() => details.create!(source));
  vi.mocked(api.AppendBatch).mockRejectedValueOnce(new Error('Source task fixture failure'));
  type('Retained draft'); await submit();
  expect(creation().value).toBe('Retained draft'); expect(host.textContent).toContain('Source task fixture failure');
  await submit();
  const calls = vi.mocked(api.AppendBatch).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1][0].map(({ type, payload }) => ({ type, payload })))
    .toEqual(calls[0][0].map(({ type, payload }) => ({ type, payload })));
  expect(creation().value).toBe('');
});

it('clears the pending source and draft on database invalidation', async () => {
  await act(async () => root.render(<App />)); act(() => details.create!(source)); type('Old database draft');
  await click(host.querySelector('button[aria-keyshortcuts="Control+Comma"]')!);
  await click(textButton(t('Verwenden')));
  expect(api.SwitchDatabase).toHaveBeenCalledWith('B.db'); expect(creation().value).toBe('');
  await click(textButton(t('Fertig')));
  type('New database task'); await submit();
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0].map(command => command.type)).toEqual(['TASK_CREATED']);
});
