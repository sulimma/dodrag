// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { AppSettings } from './bridge/eventBridge';
import { StoredEvent } from './domain/types';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ initial, animate, exit, ...props }: any) => <div {...props} /> },
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
vi.stubGlobal('matchMedia', () => ({ matches: true }));

const date = '2026-10-17T09:00:00.000Z';
const history: StoredEvent[] = ['Alpha', 'Beta'].map((title, index) => ({
  seq: index + 1, id: `event-${index}`, timestamp: date, undone: false,
  type: 'TASK_CREATED',
  payload: { taskId: `26-${101 + index}`, title, configuredStart: date, createdAt: date },
}));
const settings: AppSettings = {
  activeDatabasePath: 'A.db', databaseReady: true, autostart: false,
  knownDatabases: ['A', 'B'].map(name => ({ name, path: `${name}.db`, exists: true, isDemo: false })),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let element: HTMLDivElement;
let root: Root;
let activeSettings: AppSettings;
let api: NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;

beforeEach(() => {
  activeSettings = { ...settings };
  api = {
    GetSettings: vi.fn(async () => activeSettings),
    GetEvents: vi.fn(async () => history),
    AppendBatch: vi.fn(async () => history),
    AppendEvent: vi.fn(async () => history),
    Undo: vi.fn(async () => history), Redo: vi.fn(async () => history),
    SwitchDatabase: vi.fn(async path => {
      activeSettings = { ...settings, activeDatabasePath: path };
      return activeSettings;
    }),
    DeleteDatabase: vi.fn(async () => activeSettings),
    CreateDatabase: vi.fn(async () => activeSettings),
    OpenExistingDatabaseDialog: vi.fn(async () => activeSettings),
    SetAutostart: vi.fn(async () => activeSettings),
    SelectFolderDialog: vi.fn(async () => ''),
    EnterMiniMode: vi.fn(async () => ''), ExitMiniMode: vi.fn(async () => {}),
    UpdateMiniModeHeight: vi.fn(async () => {}), SnapMiniWindowToNearestCorner: vi.fn(async () => ''),
  };
  window.go = { main: { App: api } };
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  delete window.go;
  vi.restoreAllMocks();
});

async function mount() { await act(async () => root.render(<App />)); }
function click(target: Element) { act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function button(title: string) { return element.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!; }
function key(key: string, target: EventTarget = document.body, modifiers = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })));
}
function input(label: string) { return element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
function type(target: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function editTitle(title: string) {
  act(() => element.querySelector(`span[title="${title}"]`)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
}
function textButton(text: string) {
  return [...element.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
}
async function openSettings() {
  await act(async () => click(button('Einstellungen & Datenbanken')));
}

it.each(['title', 'date'] as const)('keeps a newer %s editor draft after the previous blur response', async kind => {
  await mount();
  const response = deferred<StoredEvent[]>();
  vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
  if (kind === 'title') editTitle('Alpha');
  else click(buttonForDate('26-101'));
  const first = input(kind === 'title' ? 'Titel 26-101' : 'Startdatum 26-101');
  type(first, kind === 'title' ? 'Alpha changed' : '2026-10-20');
  act(() => first.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  if (kind === 'title') editTitle('Beta');
  else click(buttonForDate('26-102'));
  const second = input(kind === 'title' ? 'Titel 26-102' : 'Startdatum 26-102');
  type(second, kind === 'title' ? 'Beta draft' : '2026-10-21');
  await act(async () => response.resolve(history));
  expect(second.isConnected).toBe(true);
  expect(second.value).toBe(kind === 'title' ? 'Beta draft' : '2026-10-21');
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});

function buttonForDate(id: string) {
  return element.querySelector<HTMLButtonElement>(`button[aria-label="Startdatum ${id} bearbeiten"]`)!;
}

it.each(['title', 'date'] as const)('protects cancelled and reopened same-task %s sessions', async kind => {
  await mount();
  const response = deferred<StoredEvent[]>();
  vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
  const start = () => kind === 'title' ? editTitle('Alpha') : click(buttonForDate('26-101'));
  const label = kind === 'title' ? 'Titel 26-101' : 'Startdatum 26-101';
  start();
  type(input(label), kind === 'title' ? 'First draft' : '2026-10-20');
  key('Enter', input(label));
  key('Escape', input(label));
  start();
  type(input(label), kind === 'title' ? 'Reopened draft' : '2026-10-21');
  await act(async () => response.resolve(history));
  expect(input(label).value).toBe(kind === 'title' ? 'Reopened draft' : '2026-10-21');
});

it.each(['title', 'date'] as const)('retains failed %s drafts and permits retry', async kind => {
  await mount();
  const response = deferred<StoredEvent[]>();
  vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
  if (kind === 'title') editTitle('Alpha'); else click(buttonForDate('26-101'));
  const label = kind === 'title' ? 'Titel 26-101' : 'Startdatum 26-101';
  const draft = kind === 'title' ? 'Failed draft' : '2026-10-20';
  type(input(label), draft);
  key('Enter', input(label));
  await act(async () => response.reject(new Error('Save failed')));
  expect(input(label).value).toBe(draft);
  expect(element.textContent).toContain('Save failed');
  await act(async () => key('Enter', input(label)));
  expect(input(label)).toBeNull();
  expect(api.AppendBatch).toHaveBeenCalledTimes(2);
});

it('does not close a draft changed during its own pending save', async () => {
  await mount();
  const response = deferred<StoredEvent[]>();
  vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
  editTitle('Alpha');
  type(input('Titel 26-101'), 'Submitted');
  key('Enter', input('Titel 26-101'));
  type(input('Titel 26-101'), 'Newer draft');
  await act(async () => response.resolve(history));
  expect(input('Titel 26-101').value).toBe('Newer draft');
});

it('clears old DB tasks after activation plus snapshot failure and recovers by reload', async () => {
  await mount();
  editTitle('Alpha');
  type(input('Titel 26-101'), 'Old DB draft');
  // Cancel avoids intentionally starting a save before opening settings.
  key('Escape', input('Titel 26-101'));
  await openSettings();
  vi.mocked(api.GetEvents).mockRejectedValueOnce(new Error('B snapshot failed'));
  await act(async () => click(textButton('Verwenden')));
  expect(activeSettings.activeDatabasePath).toBe('B.db');
  expect(element.querySelector('span[title="Alpha"]')).toBeNull();
  expect(textButton('Fertig').disabled).toBe(true);
  key('Escape', textButton('Fertig'));
  key('Delete'); key('z', document.body, { ctrlKey: true });
  expect(api.AppendBatch).not.toHaveBeenCalled();
  expect(api.Undo).not.toHaveBeenCalled();
  vi.mocked(api.GetEvents).mockResolvedValueOnce([{ ...history[0], payload: { ...history[0].payload, title: 'B snapshot' } } as StoredEvent]);
  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(textButton('Fertig').disabled).toBe(false);
  click(textButton('Fertig'));
  expect(element.querySelector('span[title="B snapshot"]')).not.toBeNull();
  expect(input('Titel 26-101')).toBeNull();
});

it.each([false, true])('reconciles partial native delete failure, snapshot failure=%s', async snapshotFails => {
  await mount();
  await openSettings();
  vi.mocked(api.DeleteDatabase).mockImplementationOnce(async () => {
    activeSettings = { ...settings, activeDatabasePath: 'B.db' };
    throw new Error('File deletion failed after activation');
  });
  if (snapshotFails) vi.mocked(api.GetEvents).mockRejectedValueOnce(new Error('Snapshot unavailable'));
  else vi.mocked(api.GetEvents).mockResolvedValueOnce([]);
  click(element.querySelectorAll('button[title="Datenbank löschen"]')[0]);
  await act(async () => click(textButton('Endgültig löschen')));
  expect(element.textContent).toContain('File deletion failed after activation');
  expect(textButton('Fertig').disabled).toBe(snapshotFails);
  expect(element.querySelector('span[title="Alpha"]')).toBeNull();
  if (snapshotFails) await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(activeSettings.activeDatabasePath).toBe('B.db');
  expect(textButton('Fertig').disabled).toBe(false);
});

it('ignores obsolete startup responses after a StrictMode effect restart', async () => {
  const obsolete = deferred<AppSettings>();
  vi.mocked(api.GetSettings).mockReturnValueOnce(obsolete.promise);
  await act(async () => root.render(<React.StrictMode><App /></React.StrictMode>));
  expect(element.querySelector('span[title="Alpha"]')).not.toBeNull();
  await act(async () => obsolete.resolve({ ...settings, databaseReady: false, activeDatabasePath: 'obsolete.db' }));
  expect(textButton('Fertig')).toBeUndefined();
  expect(element.querySelector('span[title="Alpha"]')).not.toBeNull();
  expect(api.GetEvents).toHaveBeenCalledTimes(1);
});

it.each(['settings', 'events'])('blocks unconfirmed startup after %s failure and allows recovery', async failure => {
  vi.mocked(failure === 'settings' ? api.GetSettings : api.GetEvents).mockRejectedValueOnce(new Error('Startup failed'));
  await mount();
  expect(element.textContent).toContain('Startup failed');
  expect(textButton('Fertig').disabled).toBe(true);
  expect(element.querySelector('span[title="Alpha"]')).toBeNull();
  key('Delete'); key('n');
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(textButton('Fertig').disabled).toBe(false);
});

it('keeps settings visible while busy and after an asynchronous error', async () => {
  await mount();
  await openSettings();
  const response = deferred<AppSettings>();
  vi.mocked(api.OpenExistingDatabaseDialog).mockReturnValueOnce(response.promise);
  click(textButton('Vorhandene Datei öffnen…'));
  expect(textButton('Fertig').disabled).toBe(true);
  key('Escape', element.querySelector('input')!);
  expect(textButton('Fertig')).toBeDefined();
  await act(async () => response.reject(new Error('Open failed')));
  expect(element.textContent).toContain('Open failed');
  expect(textButton('Fertig').disabled).toBe(false);
  key('Escape', textButton('Fertig'));
  expect(textButton('Fertig')).toBeUndefined();
});

it('blocks all hidden mini shortcuts without preventing native button keys', async () => {
  await mount();
  click(element.querySelector('span[title="Alpha"]')!);
  await act(async () => click(button('Minimieren (Kompaktansicht in Bildschirmecke)')));
  for (const shortcut of ['Delete', 'd', 'a', ' ', 'F2', 'e', 'Enter', 'n', '?']) key(shortcut);
  key('z', document.body, { ctrlKey: true });
  key('y', document.body, { ctrlKey: true });
  key('z', document.body, { ctrlKey: true, shiftKey: true });
  expect(api.AppendBatch).not.toHaveBeenCalled();
  expect(api.Undo).not.toHaveBeenCalled();
  expect(api.Redo).not.toHaveBeenCalled();
  const restore = element.querySelector('button')!;
  for (const shortcut of ['Enter', ' ']) {
    const event = new KeyboardEvent('keydown', { key: shortcut, bubbles: true, cancelable: true });
    act(() => restore.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  await act(async () => click(restore));
  expect(api.ExitMiniMode).toHaveBeenCalledTimes(1);
  expect(element.textContent).not.toContain('Tastenkürzel & Drag-and-Drop Steuerung');
  expect(input('Titel 26-101')).toBeNull();
});

it.each(['help', 'context'] as const)('Escape dismisses %s with button or input focus but preserves selection', async overlay => {
  await mount();
  click(element.querySelector('span[title="Alpha"]')!);
  for (const focus of ['button', 'input']) {
    if (overlay === 'help') click(button('Tastenkürzel & Bedienung (?)'));
    else act(() => element.querySelector('span[title="Alpha"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const target = focus === 'button' ? element.querySelector('button')! : element.querySelector('input')!;
    act(() => (target as HTMLElement).focus());
    key('Escape', target);
    expect(element.textContent).not.toContain(overlay === 'help' ? 'Tastenkürzel & Drag-and-Drop Steuerung' : 'Als erledigt markieren');
    expect(api.AppendBatch).not.toHaveBeenCalled();
  }
  act(() => (document.activeElement as HTMLElement).blur());
  await act(async () => key('Delete'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});

it('editor Escape cancels once without clearing the underlying selected task', async () => {
  await mount();
  click(element.querySelector('span[title="Alpha"]')!);
  editTitle('Alpha');
  type(input('Titel 26-101'), 'Cancelled');
  key('Escape', input('Titel 26-101'));
  expect(input('Titel 26-101')).toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => key('Delete'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});
