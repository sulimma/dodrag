// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { AppSettings } from './bridge/eventBridge';
import { StoredEvent } from './domain/types';
import { setLanguage, supportedLanguages, t } from './i18n';

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
let dragFrame: FrameRequestCallback;
let dragHit: Element | null;

beforeEach(() => {
  dragHit = null;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { dragFrame = callback; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => dragHit });
  setLanguage('de');
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
    ShowTaskContextMenu: vi.fn(async () => ''),
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
  delete window.runtime;
  delete (document as Partial<Document>).elementFromPoint;
  setLanguage('de');
  vi.restoreAllMocks();
});

async function mount() { await act(async () => root.render(<App />)); }
function click(target: Element) { act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function button(title: string) {
  return element.querySelector<HTMLElement>(`button[title="${title}"],button[title^="${title} ("]`)
    ?? element.querySelector<HTMLElement>(`[title="${title}"],[title^="${title} ("]`)!;
}
function key(key: string, target: EventTarget = document.body, modifiers = {}) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })));
}
function input(label: `Titel ${string}`): HTMLSpanElement;
function input(label: 'Task hinzufügen (Enter)'): HTMLInputElement;
function input(label: string): HTMLInputElement | HTMLSpanElement;
function input(label: string): HTMLInputElement | HTMLSpanElement {
  return label.startsWith('Titel ')
    ? element.querySelector<HTMLSpanElement>(`span[role="textbox"][data-task-title-editing="true"][aria-label="${label}"]`)!
    : element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
it('shares native mini context actions and task creation', async () => {
  await mount();
  const openContext = (target: Element) => act(() => target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 40 })
  ));
  await act(async () => openContext(element.querySelector('[data-task-drag="26-101"]')!));
  const menuActions = () => vi.mocked(api.ShowTaskContextMenu).mock.calls.at(-1)![0];
  const fullActions = menuActions();
  expect(fullActions.length).toBeGreaterThan(0);
  await act(async () => click(button('Minimieren (Kompaktansicht in Bildschirmecke)')));
  await act(async () => openContext(button('Alpha')));
  expect(menuActions()).toEqual(fullActions);
  expect(fullActions.map(item => item.id)).toEqual(['toggle', 'today', 'complete']);
  expect(fullActions.map(item => item.shortcut)).toEqual(['Space / A', 'T', 'Del / D']);
  expect(element.querySelector('.fixed.z-50.w-64')).toBeNull();
  const creation = input('Task hinzufügen (Enter)');
  type(creation, 'New mini task');
  await act(async () => creation.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_CREATED', payload: { title: 'New mini task' },
  });
  expect(creation.value).toBe('');
  expect(api.ExitMiniMode).not.toHaveBeenCalled();
});

it('offers completed tasks only reopen and preserves their start date', async () => {
  vi.mocked(api.GetEvents).mockResolvedValue([...history, {
    seq: 3, id: 'completed-alpha', timestamp: date, undone: false,
    type: 'TASK_COMPLETED', payload: { taskId: '26-101', completedAt: date },
  }]);
  vi.mocked(api.ShowTaskContextMenu).mockResolvedValueOnce('reopen');
  await mount();
  await act(async () => element.querySelector('[data-completed-task="26-101"]')!.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
  expect(vi.mocked(api.ShowTaskContextMenu).mock.calls[0][0]).toEqual([
    { id: 'reopen', label: 'Erneut öffnen', shortcut: 'O', disabled: false },
  ]);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toEqual([
    expect.objectContaining({ type: 'TASK_REOPENED', payload: { taskId: '26-101' } }),
  ]);
});

it('opens exactly one native menu under StrictMode and ignores unknown actions', async () => {
  vi.mocked(api.ShowTaskContextMenu).mockResolvedValueOnce('edit-title');
  await act(async () => root.render(<React.StrictMode><App /></React.StrictMode>));
  await act(async () => element.querySelector('[data-task-drag="26-101"]')!.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
  expect(api.ShowTaskContextMenu).toHaveBeenCalledTimes(1);
  expect(api.AppendBatch).not.toHaveBeenCalled();
  expect(input('Titel 26-101')).toBeNull();
});

it('ignores a native menu response after the database changes', async () => {
  const response = deferred<string>();
  vi.mocked(api.ShowTaskContextMenu).mockReturnValueOnce(response.promise);
  await mount();
  await act(async () => element.querySelector('[data-task-drag="26-101"]')!.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
  await openSettings();
  await act(async () => click(textButton('Verwenden')));
  await act(async () => response.resolve('complete'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('preserves a failed mini task creation draft and displays the error', async () => {
  activeSettings.bootMinimized = true;
  await mount();
  vi.mocked(api.AppendBatch).mockRejectedValueOnce(new Error('Mini save failed'));
  const creation = input('Task hinzufügen (Enter)');
  type(creation, 'Keep this draft');
  await act(async () => creation.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(creation.value).toBe('Keep this draft');
  expect(element.textContent).toContain('Mini save failed');
});

function type(target: HTMLElement, value: string) {
  act(() => {
    if (target instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
    } else target.textContent = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function editTitle(title: string) {
  click(element.querySelector(`span[data-task-title][title="${title}"]`)!);
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
  expect(second instanceof HTMLInputElement ? second.value : second.textContent).toBe(kind === 'title' ? 'Beta draft' : '2026-10-21');
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
  const reopened = input(label);
  expect(reopened instanceof HTMLInputElement ? reopened.value : reopened.textContent).toBe(kind === 'title' ? 'Reopened draft' : '2026-10-21');
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
  const failed = input(label);
  expect(failed instanceof HTMLInputElement ? failed.value : failed.textContent).toBe(draft);
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
  expect(input('Titel 26-101').textContent).toBe('Newer draft');
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

it('supports mini navigation, task actions, editors and history without preventing native button keys', async () => {
  await mount();
  selectTask('26-101');
  await act(async () => click(button('Minimieren (Kompaktansicht in Bildschirmecke)')));
  await act(async () => key('Delete'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
  key('ArrowDown');
  expect(element.querySelector('[data-mini-task-id="26-101"]')!.getAttribute('data-task-selected')).toBe('true');
  await act(async () => key('a'));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({ type: 'TASK_ACTIVE_SET', payload: { taskId: '26-101' } });
  key('ArrowDown');
  key('F2');
  expect(input('Titel 26-102')).not.toBeNull();
  key('Delete', input('Titel 26-102'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  key('Escape', input('Titel 26-102'));
  await act(async () => key('Delete'));
  expect(vi.mocked(api.AppendBatch).mock.calls[1][0][0]).toMatchObject({ type: 'TASK_COMPLETED', payload: { taskId: '26-102' } });
  vi.mocked(api.Undo).mockResolvedValue(history.map(event => ({ ...event, undone: true })));
  vi.mocked(api.Redo).mockResolvedValue(history.map(event => ({ ...event, undone: true })));
  await act(async () => key('z', document.body, { ctrlKey: true }));
  await act(async () => key('y', document.body, { ctrlKey: true }));
  await act(async () => key('z', document.body, { ctrlKey: true, shiftKey: true }));
  expect(api.Undo).toHaveBeenCalledTimes(1);
  expect(api.Redo).toHaveBeenCalledTimes(2);
  key('n');
  expect(document.activeElement).toBe(input('Task hinzufügen (Enter)'));
  key('d', input('Task hinzufügen (Enter)'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(2);
  key('?');
  expect(element.textContent).toContain('Tastenkürzel & Drag-and-Drop Steuerung');
  key('Escape', input('Task hinzufügen (Enter)'));
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

it.each(['a', 'd', 'Delete', 'F2'])('routes mini shortcut %s from task-row focus after keyboard navigation', async shortcut => {
  activeSettings.bootMinimized = true;
  await mount();
  const alpha = button('Alpha').closest<HTMLElement>('[data-mini-task-id]')!;
  act(() => alpha.focus());
  key('ArrowDown', alpha);
  expect(element.querySelector('[data-mini-task-id="26-102"]')!.getAttribute('data-task-selected')).toBe('true');
  await act(async () => key(shortcut, alpha));
  if (shortcut === 'F2') expect(input('Titel 26-102')).not.toBeNull();
  else expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: shortcut === 'a' ? 'TASK_ACTIVE_SET' : 'TASK_COMPLETED', payload: { taskId: '26-102' },
  });
  expect(api.ExitMiniMode).not.toHaveBeenCalled();
});

it.each(['help', 'context'] as const)('Escape dismisses %s with button or input focus but preserves selection', async overlay => {
  await mount();
  selectTask('26-101');
  for (const focus of ['button', 'input']) {
    if (overlay === 'help') click(button('Tastenkürzel & Bedienung (?)'));
    else act(() => element.querySelector('span[title="Alpha"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const target = focus === 'button' ? element.querySelector('button')! : element.querySelector('input')!;
    act(() => (target as HTMLElement).focus());
    key('Escape', target);
    if (overlay === 'help') expect(element.textContent).not.toContain('Tastenkürzel & Drag-and-Drop Steuerung');
    else expect(element.querySelector('.fixed.z-50.w-64')).toBeNull();
    expect(api.AppendBatch).not.toHaveBeenCalled();
  }
  act(() => (document.activeElement as HTMLElement).blur());
  await act(async () => key('Delete'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});

it('editor Escape cancels once without clearing the underlying selected task', async () => {
  await mount();
  selectTask('26-101');
  editTitle('Alpha');
  type(input('Titel 26-101'), 'Cancelled');
  key('Escape', input('Titel 26-101'));
  expect(input('Titel 26-101')).toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => key('Delete'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});

function dragEvent(target: Element, kind: string, altKey = false) {
  // Synthetic pointer input exercises the adapter; actual capture/focus needs Chromium.
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, altKey, clientX: x });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    act(() => target.dispatchEvent(event));
    return event;
  };
  dragHit = target;
  if (kind === 'dragstart') {
    pointer('pointerdown', 10);
    return pointer('pointermove', 30);
  }
  if (kind === 'dragover') {
    const event = pointer('pointermove', 30);
    act(() => dragFrame(0));
    return event;
  }
  if (kind === 'dragend') return pointer('pointercancel', 30);
  if (document.querySelector('[data-task-drag-preview]')) return pointer('pointerup', 30);
  // Unsolicited external/local drops must still be rejected by mutation guards.
  const event = new MouseEvent('drop', { bubbles: true, cancelable: true, altKey });
  Object.defineProperty(event, 'dataTransfer', { value: { getData: () => '26-101' } });
  act(() => target.dispatchEvent(event));
  return event;
}

async function chooseView(view: string) {
  if (view !== 'Liste') click(textButton(view));
}

it.each(['Liste', 'Netzplan', 'Gantt'])('preserves selection and context parity in %s', async view => {
  await mount();
  await chooseView(view);
  const row = () => element.querySelector('[data-task-drag="26-101"]')!;
  click(row());
  click(row());
  await act(async () => key('Delete'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => row().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(vi.mocked(api.ShowTaskContextMenu).mock.calls[0][0].map(item => item.label)).toContain('Als erledigt markieren');
  await act(async () => key('Delete'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_COMPLETED', payload: { taskId: '26-101' },
  });
});

it('documents the implemented drag direction, scoped Alt removal, and active shortcuts', async () => {
  await mount();
  click(button('Tastenkürzel & Bedienung (?)'));
  expect(element.textContent).toContain('Abhängigen Task auf seinen Vorgänger ziehen (A auf B: B → A)');
  expect(element.textContent).toContain('Alt: Gespeicherte Kanten der gezogenen Aufgabe Richtung Ziel lösen. Das gilt für Vorgänger und Nachfolger, nicht für den ganzen Pfad.');
  expect(element.textContent).toContain('F2 / E / Enter');
  expect(element.textContent).toContain('N: Eingabe für neuen Task fokussieren');
  expect(element.textContent).toContain('Enter (Eingabe): Task anlegen');
  expect(element.textContent).toContain('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z');
  expect(element.textContent).toContain('Rückgängig / Wiederholen');
  expect(element.textContent).toContain('Tastenkürzel gelten im aktiven Fenster, auch in der Kompaktansicht.');
  expect(element.textContent).toContain('Sie gelten auch bei fokussierten Buttons.');
  expect(element.textContent).toContain('In Textfeldern dienen Buchstaben nur der Texteingabe.');
  expect(element.textContent).toContain('Einstellungen und Hilfe sperren App-Aktionen.');
  expect(element.textContent).toContain('Ctrl+M');
  expect(element.textContent).toContain('Escape schließt Hilfe, Kontextmenü oder Editor.');
});

it.each(['main', 'mini'])('keeps syntax and shortcuts in the same blocking dialog in %s', async mode => {
  let windowMinimized = () => {};
  window.runtime = { EventsOn: (name, callback) => {
    if (name === 'window:minimized') windowMinimized = callback;
    return () => {};
  } };
  await mount();
  selectTask('26-101');
  click(element.querySelector('[data-detail-toggle]')!);
  click(button('Markdown-Syntax'));
  const dialog = () => element.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog().querySelector('h3')!.textContent).toBe('Markdown-Syntax');
  const original = dialog();
  if (mode === 'mini') await act(async () => windowMinimized());
  expect(element.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(dialog().querySelector('h3')!.textContent).toBe('Markdown-Syntax');
  for (const value of ['Delete', 'a', 'd', 'n', 'ArrowDown']) key(value, dialog().querySelector('button')!);
  key('z', dialog().querySelector('button')!, { ctrlKey: true });
  expect(api.AppendBatch).not.toHaveBeenCalled();
  click([...dialog().querySelectorAll('button')].find(item => item.textContent === 'Tastenkürzel')!);
  expect(dialog().textContent).toContain('Tastenkürzel & Drag-and-Drop Steuerung');
  click([...dialog().querySelectorAll('button')].find(item => item.textContent === 'Markdown-Syntax')!);
  if (mode === 'main') expect(dialog()).toBe(original);
  key('Escape', dialog().querySelector('button')!);
  expect(element.querySelector('[role="dialog"]')).toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it.each(['Liste', 'Netzplan', 'Gantt', 'Mini'])('focuses new-task input with N from any button in %s', async view => {
  await mount();
  if (view === 'Mini') await act(async () => click(button('Minimieren (Kompaktansicht in Bildschirmecke)')));
  else await chooseView(view);
  const creation = element.querySelector<HTMLInputElement>('input[type="text"]')!;
  for (const target of element.querySelectorAll<HTMLButtonElement>('button')) {
    act(() => target.focus());
    key('n', target);
    expect(document.activeElement).toBe(creation);
  }
  const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
  act(() => creation.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
});

it.each(['Liste', 'Netzplan', 'Gantt', 'Mini'])('sets today with T from toolbar focus in %s', async view => {
  await mount();
  if (view === 'Mini') {
    await act(async () => click(button('Minimieren (Kompaktansicht in Bildschirmecke)')));
    key('ArrowDown');
  } else {
    await chooseView(view);
    click(element.querySelector('[data-task-drag="26-101"]')!);
  }
  const toolbarButton = element.querySelector<HTMLButtonElement>('button')!;
  act(() => toolbarButton.focus());
  await act(async () => key('t', toolbarButton));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_START_DATE_SET', payload: { taskId: '26-101' },
  });
  expect((vi.mocked(api.AppendBatch).mock.calls[0][0][0].payload as any).configuredStart.slice(0, 10))
    .toBe(new Date().toISOString().slice(0, 10));
});

it('reopens a selected completed task with O while ignoring other task actions', async () => {
  vi.mocked(api.GetEvents).mockResolvedValue([...history, {
    seq: 3, id: 'completed-alpha', timestamp: date, undone: false,
    type: 'TASK_COMPLETED', payload: { taskId: '26-101', completedAt: date },
  }]);
  await mount();
  click(element.querySelector('[data-completed-task="26-101"]')!);
  const toolbarButton = element.querySelector<HTMLButtonElement>('button')!;
  for (const shortcut of ['t', 'a', 'd', 'F2']) key(shortcut, toolbarButton);
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => key('o', toolbarButton));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_REOPENED', payload: { taskId: '26-101' },
  });
});

it('toggles compact view with Ctrl+M from buttons and inputs, but not in modals', async () => {
  await mount();
  await act(async () => key('m', element.querySelector('button')!, { ctrlKey: true }));
  expect(api.EnterMiniMode).toHaveBeenCalledTimes(1);
  key('m', input('Task hinzufügen (Enter)'), { ctrlKey: true, repeat: true });
  expect(api.ExitMiniMode).not.toHaveBeenCalled();
  await act(async () => key('m', input('Task hinzufügen (Enter)'), { ctrlKey: true }));
  expect(api.ExitMiniMode).toHaveBeenCalledTimes(1);
  click(button('Tastenkürzel & Bedienung (?)'));
  key('m', document.body, { ctrlKey: true }); key('n'); key('t');
  expect(api.EnterMiniMode).toHaveBeenCalledTimes(1);
  key('Escape');
  await openSettings();
  key('m', document.body, { ctrlKey: true }); key('n'); key('t');
  expect(api.EnterMiniMode).toHaveBeenCalledTimes(1);
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('places multiple predecessor actions after completion and preserves their handler arguments', async () => {
  const tasks = ['26-101', '26-102', '26-103', '26-104', '26-105'];
  const events: StoredEvent[] = tasks.map((taskId, index) => ({
    seq: index + 1, id: `created-${taskId}`, timestamp: date, undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: date, createdAt: date },
  }));
  for (const predecessorId of tasks.slice(0, -1)) {
    events.push({
      seq: events.length + 1, id: `dependency-${predecessorId}`, timestamp: date, undone: false,
      type: 'DEPENDENCY_ADDED', payload: { taskId: '26-105', predecessorId },
    });
  }
  vi.mocked(api.GetEvents).mockResolvedValue(events);
  await mount();
  vi.mocked(api.ShowTaskContextMenu).mockResolvedValueOnce('remove:26-103');
  await act(async () => element.querySelector('[data-task-drag="26-105"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const labels = vi.mocked(api.ShowTaskContextMenu).mock.calls[0][0].map(item => item.label);
  const completedIndex = labels.findIndex(label => label?.includes('Als erledigt markieren'));
  expect(completedIndex).toBeGreaterThan(-1);
  expect(labels.slice(completedIndex + 1)).toEqual([
    'Vorgänger 26-101 lösen', 'Vorgänger 26-102 lösen',
    'Vorgänger 26-103 lösen', 'Vorgänger 26-104 lösen',
  ]);
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'DEPENDENCY_REMOVED', payload: { taskId: '26-105', predecessorId: '26-103' },
  });
});

it.each(['Liste', 'Netzplan', 'Gantt'])('adds the target as predecessor when dragging onto a task in %s', async view => {
  await mount();
  await chooseView(view);
  const source = element.querySelector('[data-task-drag="26-101"]')!;
  const target = element.querySelector('[data-task-drag="26-102"]')!;
  dragEvent(source, 'dragstart');
  await act(async () => dragEvent(target, 'drop'));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'DEPENDENCY_ADDED', payload: { taskId: '26-101', predecessorId: '26-102' },
  });
});

it.each(['Liste', 'Netzplan', 'Gantt'])('selects the drag source on Alt dragover and removes source edges in %s', async view => {
  const linked: StoredEvent[] = [...history, {
    seq: 3, id: 'dependency', timestamp: date, undone: false,
    type: 'DEPENDENCY_ADDED', payload: { taskId: '26-102', predecessorId: '26-101' },
  }];
  vi.mocked(api.GetEvents).mockResolvedValue(linked);
  await mount();
  await chooseView(view);
  const source = element.querySelector('[data-task-drag="26-101"]')!;
  const target = element.querySelector('[data-task-drag="26-102"]')!;
  click(target);
  dragEvent(source, 'dragstart');
  dragEvent(target, 'dragover', true);
  expect(source.className).toContain('bg-sky-');
  expect(element.querySelector('[data-edge-key="26-101->26-102"][data-deletion-preview="true"]')).not.toBeNull();
  await act(async () => dragEvent(target, 'drop', true));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toHaveLength(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'DEPENDENCY_REMOVED', payload: { taskId: '26-102', predecessorId: '26-101' },
  });
});

it('preserves an editor group across retries but starts a new group after cancellation', async () => {
  await mount();
  vi.mocked(api.AppendBatch).mockRejectedValueOnce(new Error('Retry'));
  editTitle('Alpha');
  type(input('Titel 26-101'), 'First');
  await act(async () => key('Enter', input('Titel 26-101')));
  await act(async () => key('Enter', input('Titel 26-101')));
  editTitle('Alpha');
  key('Escape', input('Titel 26-101'));
  editTitle('Alpha');
  type(input('Titel 26-101'), 'Second');
  await act(async () => key('Enter', input('Titel 26-101')));
  const groups = vi.mocked(api.AppendBatch).mock.calls.map(([commands]) => commands[0].groupId);
  expect(groups[0]).toBeTruthy();
  expect(groups[1]).toBe(groups[0]);
  expect(groups[2]).not.toBe(groups[0]);
});

it.each(['save', 'drag'])('blocks database switches during a pending %s', async pending => {
  await mount();
  const response = deferred<StoredEvent[]>();
  if (pending === 'save') {
    vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
    editTitle('Alpha');
    type(input('Titel 26-101'), 'Pending');
    key('Enter', input('Titel 26-101'));
  } else {
    dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
  }
  await openSettings();
  await act(async () => click(textButton('Verwenden')));
  expect(api.SwitchDatabase).not.toHaveBeenCalled();
  expect(activeSettings.activeDatabasePath).toBe('A.db');
  if (pending === 'save') await act(async () => response.resolve(history));
  else dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragend');
  // A real new click has a pointerdown, resetting suppression of the cancelled drag's click.
  act(() => textButton('Verwenden').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  await act(async () => click(textButton('Verwenden')));
  expect(api.SwitchDatabase).toHaveBeenCalledTimes(1);
});

it('keeps a newer selection when a task completion response arrives', async () => {
  await mount();
  const response = deferred<StoredEvent[]>();
  vi.mocked(api.AppendBatch).mockReturnValueOnce(response.promise);
  click(element.querySelector('[data-task-drag="26-101"]')!);
  key('Delete');
  click(element.querySelector('[data-task-drag="26-102"]')!);
  await act(async () => response.resolve(history));
  await act(async () => key('Delete'));
  expect(vi.mocked(api.AppendBatch).mock.calls[1][0][0]).toMatchObject({
    type: 'TASK_COMPLETED', payload: { taskId: '26-102' },
  });
});

it.each(['Liste', 'Netzplan', 'Gantt'])('clears edge selection on task context and selects focused edges in %s', async view => {
  vi.mocked(api.GetEvents).mockResolvedValue([...history, {
    seq: 3, id: 'dependency', timestamp: date, undone: false,
    type: 'DEPENDENCY_ADDED', payload: { taskId: '26-102', predecessorId: '26-101' },
  }]);
  await mount();
  await chooseView(view);
  const edge = () => element.querySelector('[data-edge-key="26-101->26-102"]')!;
  click(edge());
  act(() => element.querySelector('[data-task-drag="26-101"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  key('Escape');
  key('Backspace');
  expect(api.AppendBatch).not.toHaveBeenCalled();
  click(edge());
  await act(async () => key('Backspace', edge()));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'DEPENDENCY_REMOVED', payload: { taskId: '26-102', predecessorId: '26-101' },
  });
});

it('changes every view and settings immediately in all languages without rewriting user data', async () => {
  api.SetUILanguage = vi.fn(async language => {
    activeSettings = { ...activeSettings, uiLanguage: language };
    return activeSettings;
  });
  await mount();
  await openSettings();
  for (const language of supportedLanguages) {
    await act(async () => {
      const select = element.querySelector<HTMLSelectElement>('#ui-language')!;
      select.value = language;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.documentElement.lang).toBe(language);
    expect(element.querySelector('label[for="ui-language"]')!.textContent).toBe(t('Sprache (Language)'));
    expect(element.textContent).toContain(t('Neue Datenbank anlegen'));
    for (const key of ['Liste', 'Netzplan', 'Gantt']) {
      await act(async () => click(textButton(t(key))));
      expect(element.textContent).toContain('Alpha');
      expect(element.textContent).toContain('Beta');
      expect(element.textContent).toContain(t('Wiedervorlage'));
    }
  }
  expect(api.SetUILanguage).toHaveBeenCalledTimes(supportedLanguages.length);
  expect(activeSettings.knownDatabases.map(entry => entry.name)).toEqual(['A', 'B']);
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('opens the GitHub project from the version footer', async () => {
  const browserOpenURL = vi.fn();
  window.runtime = { BrowserOpenURL: browserOpenURL };
  await mount();
  await openSettings();
  await act(async () => click(button(t('GitHub-Projekt im Browser öffnen'))));
  expect(browserOpenURL).toHaveBeenCalledWith('https://github.com/sulimma/dodrag');
});

function selectTask(id: string, modifiers = {}) {
  act(() => element.querySelector(`[data-task-drag="${id}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers })));
}
function selectedIds() {
  return [...new Set([...element.querySelectorAll<HTMLElement>('[data-task-selected="true"]')].map(node => node.dataset.taskDrag))].sort();
}
const groupHistory: StoredEvent[] = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((title, index) => ({
  seq: index + 1, id: `group-${index}`, timestamp: date, undone: false,
  type: 'TASK_CREATED', payload: { taskId: `26-${101 + index}`, title, configuredStart: date, createdAt: date },
}));

it.each(['Liste', 'Netzplan', 'Gantt'])('supports ranges, additive ranges, Ctrl/Meta toggles and context selection in %s', async view => {
  vi.mocked(api.GetEvents).mockResolvedValue(groupHistory);
  await mount();
  await chooseView(view);
  selectTask('26-101');
  selectTask('26-103', { shiftKey: true });
  expect(selectedIds()).toEqual(['26-101', '26-102', '26-103']);
  selectTask('26-102', { ctrlKey: true });
  expect(selectedIds()).toEqual(['26-101', '26-103']);
  selectTask('26-104', { metaKey: true, shiftKey: true });
  expect(selectedIds()).toEqual(['26-101', '26-102', '26-103', '26-104']);
  selectTask('26-104', { metaKey: true });
  expect(selectedIds()).toEqual(['26-101', '26-102', '26-103']);
  act(() => element.querySelector('[data-task-drag="26-102"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  expect(selectedIds()).toEqual(['26-101', '26-102', '26-103']);
  key('Escape');
  act(() => element.querySelector('[data-task-drag="26-104"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  expect(selectedIds()).toEqual(['26-104']);
  key('Escape'); key('Escape');
  expect(selectedIds()).toEqual([]);
});

it('keeps sidebar content unchanged during single and multiple task selection', async () => {
  await mount();
  const sidebar = element.querySelector('aside')!;
  const content = sidebar.innerHTML;
  selectTask('26-101');
  expect(sidebar.innerHTML).toBe(content);
  selectTask('26-102', { ctrlKey: true });
  expect(sidebar.innerHTML).toBe(content);
  expect(sidebar.textContent).not.toContain('Als erledigt markieren');
});

it.each(['Delete', 'd', 'context'])('completes selected tasks with one atomic batch via %s', async route => {
  await mount();
  selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  if (route === 'context') {
    vi.mocked(api.ShowTaskContextMenu).mockResolvedValueOnce('complete');
    await act(async () => element.querySelector('[data-task-drag="26-101"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  } else await act(async () => key(route));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  const commands = vi.mocked(api.AppendBatch).mock.calls[0][0];
  expect(commands.map(command => [command.type, command.payload.taskId])).toEqual([
    ['TASK_COMPLETED', '26-101'], ['TASK_COMPLETED', '26-102'],
  ]);
  expect(commands[0].payload).toMatchObject({ completedAt: (commands[1].payload as any).completedAt });
  expect(api.AppendEvent).not.toHaveBeenCalled();
  expect(selectedIds()).toEqual([]);
});

it('resubmits each selected task relative to its own visible date in a single batch', async () => {
  const different: StoredEvent[] = [...history, {
    seq: 3, id: 'future-beta', timestamp: date, undone: false,
    type: 'TASK_START_DATE_SET', payload: { taskId: '26-102', configuredStart: '2030-04-12T11:30:00.000Z' },
  }];
  vi.mocked(api.GetEvents).mockResolvedValue(different);
  await mount(); selectTask('26-101'); selectTask('26-102', { metaKey: true });
  await act(async () => click([...element.querySelectorAll('aside .cursor-pointer')].find(node => node.textContent?.includes('+1 Tag'))!));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  const commands = vi.mocked(api.AppendBatch).mock.calls[0][0];
  expect(commands).toHaveLength(2);
  expect(commands.every(command => command.type === 'TASK_START_DATE_SET')).toBe(true);
  expect((commands[1].payload as any).configuredStart).toBe('2030-04-13T07:00:00.000Z');
  expect((commands[0].payload as any).configuredStart).not.toBe((commands[1].payload as any).configuredStart);
  expect(selectedIds()).toEqual(['26-101', '26-102']);
});

it('does not invent a task context without selection and anchors editor/log menus independently', async () => {
  api.ShowTaskContextMenuAt = vi.fn(async () => '');
  await mount();
  await act(async () => key('ContextMenu'));
  expect(api.ShowTaskContextMenuAt).not.toHaveBeenCalled();
  expect(api.ShowTaskContextMenu).not.toHaveBeenCalled();
  selectTask('26-101'); key('D', document.body, { ctrlKey: true, shiftKey: true });
  for (const selector of ['.tiptap', '[data-task-log] textarea']) {
    const field = element.querySelector<HTMLElement>(selector)!;
    act(() => field.focus());
    await act(async () => key('F10', field, { shiftKey: true }));
    const items = vi.mocked(api.ShowTaskContextMenuAt).mock.lastCall![0];
    expect(items.map(item => item.shortcut)).toEqual(['Ctrl+X', 'Ctrl+C', 'Ctrl+V']);
    expect(items.some(item => item.id === 'complete')).toBe(false);
  }
});

it('supports mini F6, anchored task menus and Ctrl++ without restoring, but not completed tasks', async () => {
  api.ShowTaskContextMenuAt = vi.fn(async () => '');
  await mount();
  await act(async () => key('m', document.body, { ctrlKey: true }));
  const field = element.querySelector<HTMLInputElement>('input')!;
  act(() => field.focus()); key('F6', field);
  expect(document.activeElement).toBe(element.querySelector('[data-shortcut-region="1"]'));
  key('ArrowDown');
  await act(async () => key('ContextMenu'));
  expect(api.ShowTaskContextMenuAt).toHaveBeenCalledOnce();
  await act(async () => key('+', document.body, { ctrlKey: true }));
  expect(api.AppendBatch).toHaveBeenCalledOnce(); expect(api.ExitMiniMode).not.toHaveBeenCalled();
  await act(async () => key('m', document.body, { ctrlKey: true }));
  vi.mocked(api.GetEvents).mockResolvedValue([...history, { seq: 3, id: 'done', timestamp: date, undone: false,
    type: 'TASK_COMPLETED', payload: { taskId: '26-101', completedAt: date } }]);
  await act(async () => root.render(<App key="completed-check" />));
  selectTask('26-101');
  await act(async () => key('+', document.body, { ctrlKey: true }));
  expect(api.AppendBatch).toHaveBeenCalledOnce();
});

it.each(['Liste', 'Netzplan', 'Gantt'])('freezes the drag group and links every member to the target in one batch in %s', async view => {
  vi.mocked(api.GetEvents).mockResolvedValue(groupHistory);
  vi.mocked(api.AppendBatch).mockResolvedValue(groupHistory);
  await mount(); await chooseView(view);
  selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
  selectTask('26-104');
  await act(async () => dragEvent(element.querySelector('[data-task-drag="26-103"]')!, 'drop'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0].map(command => command.payload)).toEqual([
    { taskId: '26-101', predecessorId: '26-103' }, { taskId: '26-102', predecessorId: '26-103' },
  ]);
  expect(selectedIds()).toEqual(['26-104']);
});

it('omits self edges but links the remaining group when dropping onto its source', async () => {
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  const source = element.querySelector('[data-task-drag="26-101"]')!;
  dragEvent(source, 'dragstart');
  await act(async () => dragEvent(source, 'drop'));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toHaveLength(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0].payload).toEqual({ taskId: '26-102', predecessorId: '26-101' });
});

it('rejects the entire group before persistence when a later member would create a cycle', async () => {
  vi.mocked(api.GetEvents).mockResolvedValue([...groupHistory, {
    seq: 5, id: 'cycle-edge', timestamp: date, undone: false,
    type: 'DEPENDENCY_ADDED', payload: { taskId: '26-103', predecessorId: '26-102' },
  }]);
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
  await act(async () => dragEvent(element.querySelector('[data-task-drag="26-103"]')!, 'drop'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
  expect(element.textContent).toContain('Zyklus verhindert');
  expect(selectedIds()).toEqual(['26-101', '26-102']);
});

it.each(['date', 'resubmit', 'complete'])('applies %s drops to the frozen group, not the later selection', async route => {
  vi.mocked(api.GetEvents).mockResolvedValue(groupHistory);
  vi.mocked(api.AppendBatch).mockResolvedValue(groupHistory);
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
  selectTask('26-104');
  const target = route === 'date' ? element.querySelector('[data-flip-key^="date:"]')!
    : route === 'resubmit' ? element.querySelector('aside .cursor-pointer')!
    : element.querySelector('aside .flex-1.min-h-0')!;
  await act(async () => dragEvent(target, 'drop'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0].map(command => command.payload.taskId)).toEqual(['26-101', '26-102']);
  expect(selectedIds()).toEqual(['26-104']);
});

it('keeps group selection during Alt drag and removes only original-source path edges', async () => {
  vi.mocked(api.GetEvents).mockResolvedValue([...groupHistory, ...[
    ['26-101', '26-102'], ['26-102', '26-103'], ['26-101', '26-103'],
  ].map(([predecessorId, taskId], index) => ({
    seq: 5 + index, id: `shift-edge-${index}`, timestamp: date, undone: false,
    type: 'DEPENDENCY_ADDED' as const, payload: { taskId, predecessorId },
  }))]);
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart', true);
  const target = element.querySelector('[data-task-drag="26-103"]')!;
  dragEvent(target, 'dragover', true);
  expect(selectedIds()).toEqual(['26-101', '26-102']);
  expect([...element.querySelectorAll('[data-deletion-preview="true"]')].map(node => node.getAttribute('data-edge-key')).sort())
    .toEqual(['26-101->26-102', '26-101->26-103']);
  await act(async () => dragEvent(target, 'drop', true));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0].map(command => command.payload)).toEqual([
    { taskId: '26-102', predecessorId: '26-101' }, { taskId: '26-103', predecessorId: '26-101' },
  ]);
});

it('retains a failed completion group and ignores external or cancelled drop identities', async () => {
  vi.mocked(api.AppendBatch).mockRejectedValueOnce(new Error('Batch failed'));
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  await act(async () => key('Delete'));
  expect(selectedIds()).toEqual(['26-101', '26-102']);
  const source = element.querySelector('[data-task-drag="26-101"]')!;
  dragEvent(source, 'dragstart'); key('Escape');
  await act(async () => dragEvent(element.querySelector('aside .flex-1.min-h-0')!, 'drop'));
  await act(async () => dragEvent(element.querySelector('[data-task-drag="26-102"]')!, 'drop'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
});

it('opens F1 help and settings from text fields while modal dialogs block other new shortcuts', async () => {
  await mount();
  const field = element.querySelector<HTMLInputElement>('header input')!;
  key('F1', field);
  expect(element.querySelector('[role="dialog"]')).not.toBeNull();
  key('3', field, { ctrlKey: true }); key(',', field, { ctrlKey: true });
  expect(element.querySelector('[data-shortcut-region="1"]')?.getAttribute('data-task-drop-target')).toBe('list-background');
  key('Escape');
  await act(async () => key(',', field, { ctrlKey: true }));
  expect(element.textContent).toContain(t('Einstellungen & Datenbanken'));
  expect(element.querySelector('.fixed.inset-0.z-50')).not.toBeNull();
  key('F1'); expect(element.querySelector('[role="dialog"]')).toBeNull();
});

it('switches main views and details with exact control modifiers but leaves mini views alone', async () => {
  await mount();
  for (const [keyValue, view] of [['2', 'network'], ['3', 'gantt'], ['1', 'list']]) {
    key(keyValue, document.body, { ctrlKey: true });
    expect(element.querySelector(`button[aria-keyshortcuts="Control+${keyValue}"]`)!.className).toContain('bg-white');
    if (view === 'list') expect(element.querySelector('main')!.getAttribute('data-task-drop-target')).toBe('list-background');
  }
  key('D', document.body, { ctrlKey: true, shiftKey: true });
  expect(element.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe('true');
  key('D', document.body, { ctrlKey: true, shiftKey: true, repeat: true });
  expect(element.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe('true');
  key('D', document.body, { ctrlKey: true, shiftKey: true });
  expect(element.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe('false');
  await act(async () => key('m', document.body, { ctrlKey: true }));
  key('3', document.body, { ctrlKey: true }); key('D', document.body, { ctrlKey: true, shiftKey: true });
  expect(api.ExitMiniMode).not.toHaveBeenCalled();
  await act(async () => key(',', document.body, { ctrlKey: true }));
  expect(api.ExitMiniMode).toHaveBeenCalledOnce();
  expect(element.querySelector('.fixed.inset-0.z-50')).not.toBeNull();
});

it('cycles F6 regions forward and backward, including the editor and log but not a collapsed panel', async () => {
  await mount(); selectTask('26-101');
  const main = element.querySelector<HTMLElement>('main')!;
  act(() => main.focus());
  key('F6', main);
  expect(document.activeElement).toBe(element.querySelector('[data-shortcut-region="5"]'));
  key('F6', document.activeElement!, { shiftKey: true }); expect(document.activeElement).toBe(main);
  key('D', main, { ctrlKey: true, shiftKey: true });
  key('F6', main); expect(document.activeElement).toBe(element.querySelector('[data-task-detail-panel]'));
  key('F6', document.activeElement!); expect(document.activeElement?.closest('[data-description-editor]')).not.toBeNull();
  key('F6', document.activeElement!); expect(document.activeElement).toBe(element.querySelector('[data-task-log] textarea'));
  key('F6', document.activeElement!, { shiftKey: true }); expect(document.activeElement?.closest('[data-description-editor]')).not.toBeNull();
  key('D', document.activeElement!, { ctrlKey: true, shiftKey: true }); expect(document.activeElement).toBe(main);
});

it.each([['+', {}], ['+', { shiftKey: true }], ['Add', { code: 'NumpadAdd' }]])('resubmits with Ctrl plus %s, ignores repeats, text entry and AltGr', async (value, modifiers) => {
  await mount(); selectTask('26-101');
  const field = element.querySelector<HTMLInputElement>('header input')!;
  key(value, field, { ctrlKey: true, ...modifiers });
  key(value, document.body, { ctrlKey: true, altKey: true, ...modifiers });
  key(value, document.body, { ctrlKey: true, repeat: true, ...modifiers });
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => key(value, document.body, { ctrlKey: true, ...modifiers }));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({ type: 'TASK_START_DATE_SET', payload: { taskId: '26-101' } });
});

it.each([['F10', { shiftKey: true }], ['ContextMenu', {}]])('anchors %s native menus to the selected task and retains multi-selection', async (value, modifiers) => {
  api.ShowTaskContextMenuAt = vi.fn(async () => '');
  await mount(); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  const target = element.querySelector('[data-task-drag="26-102"]')!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 50, 100, 30));
  await act(async () => key(value, document.body, modifiers));
  expect(api.ShowTaskContextMenuAt).toHaveBeenCalledWith(expect.any(Array), { x: 40, y: 80 });
  expect(api.ShowTaskContextMenu).not.toHaveBeenCalled();
  expect(selectedIds()).toEqual(['26-101', '26-102']);
});
