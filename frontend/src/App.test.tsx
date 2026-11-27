import { commandTaskId } from './domain/eventSchema';
// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { AppSettings } from './bridge/eventBridge';
import type { TimeMeasurementSession, TimeMeasurementState } from './plugins/time-measurement/types';
import { StoredEvent } from './domain/types';
import { projectEvents, toDateKey } from './domain/projector';
import { setLanguage, supportedLanguages, t } from './i18n';

// jsdom has no compositor; frame scheduling is verified by the hook tests.
vi.mock('./hooks/useWindowPresentation', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useWindowPresentation')>(),
  allowWindowPaint: vi.fn(async () => {}),
}));

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
    SetEditorReady: vi.fn(async () => {}), FinishClose: vi.fn(async () => {}),
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
    GetWindowMaximized: vi.fn(async () => false), ToggleWindowMaximized: vi.fn(async () => {}),
    RequestWindowClose: vi.fn(async () => {}), ShowWindowSystemMenu: vi.fn(async () => {}),
    GetWindowMode: vi.fn(async () => 'window' as const), SetWindowMode: vi.fn(async (mode: 'taskbar' | 'mini' | 'window') => mode),
    ShowTaskContextMenu: vi.fn(async () => ''),
    UpdateMiniModeHeight: vi.fn(async () => {}),
  };
  api.ShowTaskContextMenuAt = api.ShowTaskContextMenu;
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
  vi.useRealTimers();
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
it('uses the decorated desktop without offering unsupported window, setup or autostart actions', async () => {
  activeSettings.capabilities = { miniWindow: false, nativeTaskMenu: false, selfInstall: false, autostart: false };
  activeSettings.bootMinimized = true;
  activeSettings.setup = { currentExe: '/opt/dodrag', installPath: '/opt/dodrag', programInstalled: false,
    installedVersionOlder: true, desktopShortcut: false, startMenuShortcut: false };
  await mount();
  const settingsHeading = () => Array.from(element.querySelectorAll('h2')).find(heading =>
    heading.textContent === t('Einstellungen & Datenbanken'));
  expect(button(t('Kompaktansicht'))).toBeNull();
  expect(settingsHeading()).toBeUndefined();
  key('m', document.body, { ctrlKey: true });
  expect(api.GetWindowMode).not.toHaveBeenCalled();
  expect(api.GetWindowMaximized).not.toHaveBeenCalled();
  expect(api.SetWindowMode).not.toHaveBeenCalled();
  expect(api.UpdateMiniModeHeight).not.toHaveBeenCalled();
  await act(async () => key(',', document.body, { ctrlKey: true }));
  expect(settingsHeading()).toBeDefined();
  expect(element.querySelector(`[role="switch"][aria-label="${t('Beim Booten automatisch starten')}"]`)).toBeNull();
  expect(textButton(t('Programm in den Benutzerordner installieren'))).toBeUndefined();
});

it('opens Linux task menus with the keyboard and pointer and returns focus on dismissal', async () => {
  activeSettings.capabilities = { miniWindow: false, nativeTaskMenu: false, selfInstall: false, autostart: false };
  const folder = '/work/Plan #2';
  api.GetPathKind = vi.fn(async (path: string) => {
    if (path === folder + '/') return 'directory' as const;
    throw new Error('missing path');
  });
  api.OpenFolderInExplorer = vi.fn(async () => {});
  vi.mocked(api.GetEvents).mockResolvedValue([...history, {
    seq: 3, id: 'desc', timestamp: date, undone: false, type: 'TASK_DESCRIPTION_SET',
    payload: { taskId: '26-101', description: `Files: "${folder}"` },
  }]);
  await mount();
  const region = element.querySelector<HTMLElement>('[data-shortcut-region="1"]')!;
  const menu = () => document.querySelector('[role="menu"]');
  act(() => region.focus());
  selectTask('26-101');
  await act(async () => key('F10', region, { shiftKey: true }));
  expect(menu()?.contains(document.activeElement)).toBe(true);
  const first = document.activeElement;
  key('End', first!);
  expect(document.activeElement?.textContent).toContain(folder);
  key('ArrowUp', document.activeElement!);
  expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  key('Home', document.activeElement!);
  expect(document.activeElement).toBe(first);
  await act(async () => key('Escape', first!));
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(region);
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => key('ContextMenu', region));
  key('End', document.activeElement!);
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(api.OpenFolderInExplorer).toHaveBeenCalledWith(folder + '/', false);
  expect(menu()).toBeNull();
  const task = element.querySelector('[data-task-drag="26-101"]')!;
  await act(async () => task.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 80 })));
  expect(menu()).not.toBeNull();
  const complete = Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find(item => item.textContent?.startsWith(t('Als erledigt markieren')))!;
  await act(async () => complete.click());
  expect(menu()).toBeNull();
  expect(vi.mocked(api.AppendBatch).mock.lastCall?.[0]).toMatchObject([{ type: 'TASK_COMPLETED', payload: { taskId: '26-101' } }]);
  expect(api.ShowTaskContextMenu).not.toHaveBeenCalled();
});

it('displays the native mini mode returned on startup', async () => {
  vi.mocked(api.GetWindowMode).mockResolvedValueOnce('mini');
  await mount();
  expect(element.querySelector('[data-app-title-bar]')?.closest('[inert]')).not.toBeNull();
  expect(button('Fenster')).not.toBeNull();
});

it('opens installation settings on startup with an older installed executable', async () => {
  activeSettings.bootMinimized = true;
  const setup = {
    currentExe: 'C:\\Downloads\\DoDrag.exe',
    installPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\DoDrag\\DoDrag.exe',
    programInstalled: false, installedVersionOlder: true, desktopShortcut: true, startMenuShortcut: true,
  };
  activeSettings.setup = setup;
  api.RunSetupAction = vi.fn(async () => ({
    ...activeSettings, setup: { ...setup, programInstalled: true, installedVersionOlder: false },
  }));

  await mount();
  expect(api.SetWindowMode).not.toHaveBeenCalledWith('mini');
  const installButton = textButton(t('Programm in den Benutzerordner installieren'));
  expect(installButton?.disabled).toBe(false);
  expect(api.RunSetupAction).not.toHaveBeenCalled();

  await act(async () => click(installButton));
  expect(api.RunSetupAction).toHaveBeenCalledWith('install');
  expect(textButton(t('Programm in den Benutzerordner installieren'))).toBeUndefined();
  await act(async () => key('Escape'));
  expect(element.querySelector('[data-task-drag="26-101"]')).not.toBeNull();
});

it('uses confirmed startup and event modes, including a late startup response', async () => {
  const startup = deferred<'window'>();
  vi.mocked(api.GetWindowMode).mockReturnValue(startup.promise);
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await mount();
  await act(async () => events.get('window:mode-changed')!('mini'));
  expect(element.querySelector('[data-app-title-bar]')?.closest('[inert]')).not.toBeNull();
  await act(async () => startup.resolve('window'));
  expect(element.querySelector('[data-app-title-bar]')?.closest('[inert]')).not.toBeNull();
  await act(async () => events.get('window:mode-changed')!('window'));
  expect(element.querySelector('[data-app-title-bar]')).not.toBeNull();
});

it('keeps the current view when a native mode change is rejected', async () => {
  vi.mocked(api.SetWindowMode).mockRejectedValueOnce(new Error('native failure'));
  await mount();
  await act(async () => click(button('Kompaktansicht')));
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
  expect(element.querySelector('main')).not.toBeNull();
  expect(element.querySelector('[data-mini-task-id]')).toBeNull();
  expect(element.querySelector('[data-app-title-bar]')).not.toBeNull();
});

it('ignores a queued native request if its starting mode is stale', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  const response = deferred<'mini'>();
  vi.mocked(api.SetWindowMode).mockReturnValueOnce(response.promise);
  await mount();
  act(() => click(button('Kompaktansicht')));
  await act(async () => { await Promise.resolve(); });
  act(() => events.get('window:mode-requested')!('taskbar', false, 'window'));
  await act(async () => response.resolve('mini'));
  expect(api.SetWindowMode).toHaveBeenCalledTimes(1);
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
  expect(element.querySelector('[data-app-title-bar]')?.closest('[inert]')).not.toBeNull();
});

it('does not call the host for a request to the confirmed active mode', async () => {
  let request: (...args: any[]) => void = () => {};
  window.runtime = { EventsOn: (name, callback) => { if (name === 'window:mode-requested') request = callback; return () => {}; } };
  await mount();
  await act(async () => request('window', false));
  expect(api.SetWindowMode).not.toHaveBeenCalled();
});

it('routes title bar actions to native window functions and tracks maximization events', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await mount();
  await act(async () => click(button('Maximieren')));
  expect(api.ToggleWindowMaximized).toHaveBeenCalledOnce();
  act(() => events.get('window:maximized-changed')!(true));
  expect(button('Fenster wiederherstellen')).not.toBeNull();
  await act(async () => click(button('Fenster wiederherstellen')));
  expect(api.ToggleWindowMaximized).toHaveBeenCalledTimes(2);
  await act(async () => click(button('Schließen')));
  expect(api.RequestWindowClose).toHaveBeenCalledOnce();
  await act(async () => element.querySelector('[data-app-title-bar]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(api.ShowWindowSystemMenu).toHaveBeenCalledOnce();
  await act(async () => click(button('In die Taskleiste minimieren')));
  expect(api.SetWindowMode).toHaveBeenCalledWith('taskbar');
});

it('routes mini title controls to taskbar and window modes', async () => {
  await mount();
  await act(async () => click(button('Kompaktansicht')));
  expect(element.querySelector('[data-app-title-bar]')?.closest('[inert]')).not.toBeNull();
  await act(async () => click(button('In die Taskleiste minimieren')));
  expect(api.SetWindowMode).toHaveBeenCalledWith('taskbar');
});

it('shares native mini context actions and task creation', async () => {
  await mount();
  const openContext = (target: Element) => act(() => target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 40 })
  ));
  await act(async () => openContext(element.querySelector('[data-task-drag="26-101"]')!));
  const menuActions = () => vi.mocked(api.ShowTaskContextMenu).mock.calls.at(-1)![0];
  const fullActions = menuActions();
  expect(fullActions.length).toBeGreaterThan(0);
  await act(async () => click(button('Kompaktansicht')));
  await act(async () => openContext(button('Alpha')));
  expect(menuActions()).toEqual(fullActions);
  expect(fullActions.map(item => item.id)).toEqual(['toggle', 'today', 'complete', 'open-copy', 'create-successor']);
  expect(fullActions.flatMap(item => item.shortcut ? [item.shortcut] : [])).toEqual(['Space / A', 'T', 'Del / D']);
  expect(element.querySelector('.fixed.z-50.w-64')).toBeNull();
  const creation = input('Task hinzufügen (Enter)');
  type(creation, 'New mini task');
  await act(async () => creation.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_CREATED', payload: { title: 'New mini task' },
  });
  expect(creation.value).toBe('');
  expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
});

it('selects the reopened task and preserves its configured date', async () => {
  const events: StoredEvent[] = [...history, {
    seq: 3, id: 'completed-alpha', timestamp: date, undone: false,
    type: 'TASK_COMPLETED', payload: { taskId: '26-101', completedAt: date },
  }];
  vi.mocked(api.GetEvents).mockResolvedValue(events);
  vi.mocked(api.AppendBatch).mockImplementation(async commands => [...events, ...commands.map(command => ({
    ...command, seq: 4, timestamp: date, undone: false,
  }))]);
  vi.mocked(api.ShowTaskContextMenu).mockResolvedValueOnce('reopen');
  await mount();
  click(element.querySelector('[data-completed-task="26-101"]')!);
  selectTask('26-102', { ctrlKey: true });
  await act(async () => element.querySelector('[data-completed-task="26-101"]')!.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  ));
  expect(vi.mocked(api.ShowTaskContextMenu).mock.calls[0][0]).toEqual([
    { id: 'reopen', label: t('Erneut öffnen'), shortcut: 'O', disabled: false },
    { id: 'open-copy', label: t('Kopie Öffnen'), disabled: false },
    { id: 'create-successor', label: t('Nachfolger anlegen'), disabled: false },
  ]);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toEqual([
    expect.objectContaining({ type: 'TASK_REOPENED', payload: { taskId: '26-101' } }),
  ]);
  expect(selectedIds()).toEqual(['26-101']);
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

it('reopens the configured database after an unavailable startup and permits retry after failure', async () => {
  activeSettings = { ...settings, databaseReady: false };
  vi.mocked(api.SwitchDatabase).mockRejectedValueOnce(new Error('Drive unavailable'));
  await mount();
  expect(api.GetEvents).not.toHaveBeenCalled();
  expect(element.querySelector('span[title="Alpha"]')).toBeNull();

  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(element.textContent).toContain('Drive unavailable');
  expect(api.GetEvents).not.toHaveBeenCalled();
  key('n');
  expect(api.AppendBatch).not.toHaveBeenCalled();

  // Drive is now mounted; the native store stays closed until explicitly opened.
  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(api.SwitchDatabase).toHaveBeenCalledTimes(2);
  expect(api.SwitchDatabase).toHaveBeenLastCalledWith(settings.activeDatabasePath);
  expect(textButton('Fertig').disabled).toBe(false);
  click(textButton('Fertig'));
  expect(element.querySelector('span[title="Alpha"]')).not.toBeNull();
});

it('shows the native upgrade requirement on startup and clears it after recovery', async () => {
  const databaseError = 'Please update DoDrag to at least 9.0.0';
  activeSettings = { ...settings, databaseReady: false, databaseError };
  await mount();
  expect(element.textContent).toContain(databaseError);
  expect(api.GetEvents).not.toHaveBeenCalled();
  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(textButton('Fertig').disabled).toBe(false);
  expect(element.textContent).not.toContain(databaseError);
  click(textButton('Fertig'));
  expect(element.querySelector('span[title="Alpha"]')).not.toBeNull();
});

it('shows a database validation failure when retrying an unavailable startup', async () => {
  activeSettings = { ...settings, databaseReady: false };
  vi.mocked(api.SwitchDatabase).mockRejectedValue(new Error('validate event store: event 1141: unexpected payload fields for TASK_CREATED'));
  await mount();
  await act(async () => click(textButton('Aktive Datenbank erneut laden')));
  expect(element.textContent).toContain('event 1141');
  expect(api.GetEvents).not.toHaveBeenCalled();
  expect(textButton('Aktive Datenbank erneut laden').disabled).toBe(false);
  expect(element.querySelector('span[title="Alpha"]')).toBeNull();
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
  key('Escape', textButton('Schließen'));
  expect(textButton('Schließen')).toBeDefined();
  expect(api.RequestWindowClose).not.toHaveBeenCalled();
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
  expect(textButton(snapshotFails ? 'Schließen' : 'Fertig').disabled).toBe(false);
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

it.each(['settings', 'events'])('blocks unconfirmed startup after %s failure and allows closing or recovery', async failure => {
  vi.mocked(failure === 'settings' ? api.GetSettings : api.GetEvents).mockRejectedValueOnce(new Error('Startup failed'));
  await mount();
  expect(element.textContent).toContain('Startup failed');
  const close = textButton('Schließen');
  expect(close.disabled).toBe(false);
  await act(async () => click(close));
  expect(api.RequestWindowClose).toHaveBeenCalledOnce();
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

it('opens a mini task before editing and keeps task actions, history and native button keys working', async () => {
  await mount();
  selectTask('26-101');
  await act(async () => click(button('Kompaktansicht')));
  await act(async () => key('Delete'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
  key('ArrowDown');
  expect(element.querySelector('[data-mini-task-id="26-101"]')!.getAttribute('data-task-selected')).toBe('true');
  await act(async () => key('a'));
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({ type: 'TASK_ACTIVE_SET', payload: { taskId: '26-101' } });
  key('ArrowDown');
  await act(async () => key('F2'));
  expect(api.SetWindowMode).toHaveBeenCalledWith('window');
  expect(element.querySelector('[data-mini-task-id]')).toBeNull();
  expect(element.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe('true');
  expect(input('Titel 26-102')).toBeNull();
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
  const newTaskInput = element.querySelector<HTMLInputElement>('header input')!;
  expect(document.activeElement).toBe(newTaskInput);
  key('d', newTaskInput);
  expect(api.AppendBatch).toHaveBeenCalledTimes(2);
  key('?');
  expect(element.textContent).toContain('Tastenkürzel & Drag-and-Drop Steuerung');
  key('Escape', newTaskInput);
  const restore = element.querySelector<HTMLButtonElement>('button[aria-label="Maximieren"]')!;
  for (const shortcut of ['Enter', ' ']) {
    const event = new KeyboardEvent('keydown', { key: shortcut, bubbles: true, cancelable: true });
    act(() => restore.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(api.SetWindowMode).toHaveBeenCalledWith('window');
  expect(element.textContent).not.toContain('Tastenkürzel & Drag-and-Drop Steuerung');
  expect(input('Titel 26-101')).toBeNull();
});

it.each(['a', 'd', 'Delete', 'F2', 'e', 'Enter'])('routes mini shortcut %s from task-row focus after keyboard navigation', async shortcut => {
  activeSettings.bootMinimized = true;
  await mount();
  const alpha = button('Alpha').closest<HTMLElement>('[data-mini-task-id]')!;
  act(() => alpha.focus());
  key('ArrowDown', alpha);
  expect(element.querySelector('[data-mini-task-id="26-102"]')!.getAttribute('data-task-selected')).toBe('true');
  await act(async () => key(shortcut, alpha));
  if (['F2', 'e', 'Enter'].includes(shortcut)) {
    expect(input('Titel 26-102')).toBeNull();
    expect(api.SetWindowMode).toHaveBeenCalledWith('window');
    expect(element.querySelector('[data-detail-toggle]')!.getAttribute('aria-expanded')).toBe('true');
  }
  else expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: shortcut === 'a' ? 'TASK_ACTIVE_SET' : 'TASK_COMPLETED', payload: { taskId: '26-102' },
  });
  if (!['F2', 'e', 'Enter'].includes(shortcut)) expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
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

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('preserves selection and context parity in %s', async view => {
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

it.each([
  { view: 'Protokoll', completed: true, title: 'Alpha', expectedTitle: 'Alpha (2)' },
  { view: 'Liste', completed: false, title: 'Alpha (99)', expectedTitle: 'Alpha (100)' },
])('opens and selects a copy of $title in $view', async ({ view, completed, title, expectedTitle }) => {
    const sourceId = '26-101';
    const events: StoredEvent[] = [
      { ...history[0], type: 'TASK_CREATED', payload: {
        taskId: sourceId, title, configuredStart: date, createdAt: date,
      } },
      { seq: 2, id: 'description', timestamp: date, undone: false, type: 'TASK_DESCRIPTION_SET',
        payload: { taskId: sourceId, description: 'Saved details' } },
      { seq: 3, id: 'timing', timestamp: date, undone: false, type: 'TASK_TIMING_SET',
        payload: { taskId: sourceId, duration: 2.5, durationUnit: 'hours', progress: 1 } },
      { seq: 4, id: 'note', timestamp: date, undone: false, type: 'TASK_LOG_ADDED',
        payload: { taskId: sourceId, entryId: 'note', text: 'Old note', createdAt: date } },
    ];
    if (completed) events.push({ seq: 5, id: 'complete', timestamp: date, undone: false, type: 'TASK_COMPLETED',
      payload: { taskId: sourceId, completedAt: date } });
    vi.mocked(api.GetEvents).mockResolvedValue(events);
    vi.mocked(api.ShowTaskContextMenu).mockImplementation(async items =>
      items.find(item => item.label === t('Kopie Öffnen'))?.id ?? '');
    let saved = events;
    vi.mocked(api.AppendBatch).mockImplementation(async commands => {
      saved = [...events, ...commands.map((command, index) => ({
        ...command, seq: events.length + index + 1, timestamp: new Date().toISOString(), undone: false,
      }))];
      return saved;
    });
    await mount();
    await chooseView(view);
    const row = element.querySelector(`[data-task-drag="${sourceId}"]:not([data-completed-task])`)!;
    await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));

    expect(api.AppendBatch).toHaveBeenCalledOnce();
    const state = projectEvents(saved, new Date());
    expect(state.tasks[sourceId].completed).toBe(completed);
    const copies = state.openTasks.filter(task => task.id !== sourceId);
    expect(copies).toHaveLength(1);
    const [copy] = copies;
    expect(copy).toMatchObject({
      title: expectedTitle, allPredecessorIds: [sourceId],
      description: 'Saved details', duration: 2.5, durationUnit: 'hours', progress: null,
    });
    expect(toDateKey(new Date(copy.configuredStart))).toBe(toDateKey(new Date(copy.createdAt)));

    expect(element.querySelector(`[data-task-drag="${copy.id}"][data-task-selected="true"]`)).not.toBeNull();
    expect(row.getAttribute('data-dependency-highlight')).toBe('predecessor');
    const detailToggle = element.querySelector('[data-detail-toggle]')!;
    if (detailToggle.getAttribute('aria-expanded') === 'false') click(detailToggle);
    const entries = element.querySelectorAll('[data-task-log] [data-log-entry]');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain(t('Aus {id} als Kopie erstellt', { id: sourceId }));
    expect(entries[0].textContent).toContain('🟩');
});

it('highlights closed predecessors and successors in the sidebar and protocol', async () => {
  const events: StoredEvent[] = [
    ...groupHistory,
    { seq: 5, id: 'pred', timestamp: date, undone: false, type: 'DEPENDENCY_ADDED',
      payload: { taskId: '26-102', predecessorId: '26-101' } },
    { seq: 6, id: 'succ', timestamp: date, undone: false, type: 'DEPENDENCY_ADDED',
      payload: { taskId: '26-103', predecessorId: '26-102' } },
    ...['26-101', '26-103', '26-104'].map((taskId, index) => ({
      seq: 7 + index, id: `close-${taskId}`, timestamp: date, undone: false, type: 'TASK_COMPLETED' as const,
      payload: { taskId, completedAt: date },
    })),
  ];
  vi.mocked(api.GetEvents).mockResolvedValue(events);
  await mount();
  selectTask('26-102');
  const role = (selector: string) => element.querySelector(selector)!.getAttribute('data-dependency-highlight');
  expect(role('[data-completed-task="26-101"]')).toBe('predecessor');
  expect(role('[data-completed-task="26-103"]')).toBe('successor');
  expect(role('[data-completed-task="26-104"]')).toBeNull();

  await chooseView('Protokoll');
  expect(role('[data-protocol-view] [data-task-drag="26-101"]')).toBe('predecessor');
  expect(role('[data-protocol-view] [data-task-drag="26-103"]')).toBe('successor');
  expect(role('[data-protocol-view] [data-task-drag="26-104"]')).toBeNull();
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
    if (name === 'window:mode-changed') windowMinimized = () => callback('mini');
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
  if (view === 'Mini') await act(async () => click(button('Kompaktansicht')));
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
    await act(async () => click(button('Kompaktansicht')));
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
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
  key('m', input('Task hinzufügen (Enter)'), { ctrlKey: true, repeat: true });
  expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
  await act(async () => key('m', input('Task hinzufügen (Enter)'), { ctrlKey: true }));
  expect(api.SetWindowMode).toHaveBeenCalledWith('window');
  click(button('Tastenkürzel & Bedienung (?)'));
  key('m', document.body, { ctrlKey: true }); key('n'); key('t');
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
  key('Escape');
  await openSettings();
  key('m', document.body, { ctrlKey: true }); key('n'); key('t');
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
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
  expect(labels.slice(completedIndex + 1).filter(label => label?.startsWith('Vorgänger '))).toEqual([
    'Vorgänger 26-101 lösen', 'Vorgänger 26-102 lösen',
    'Vorgänger 26-103 lösen', 'Vorgänger 26-104 lösen',
  ]);
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'DEPENDENCY_REMOVED', payload: { taskId: '26-105', predecessorId: '26-103' },
  });
});

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('adds the target as predecessor when dragging onto a task in %s', async view => {
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

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('selects the drag source on Alt dragover and removes source edges in %s', async view => {
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

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('clears edge selection on task context and selects focused edges in %s', async view => {
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
    for (const key of ['Liste', 'Netzplan', 'Gantt', 'Protokoll']) {
      await act(async () => click(textButton(t(key))));
      expect(element.textContent).toContain('Alpha');
      expect(element.textContent).toContain('Beta');
      expect(element.textContent).toContain(t('Wiedervorlage'));
    }
  }
  expect(api.SetUILanguage).toHaveBeenCalledTimes(supportedLanguages.length);
  expect(activeSettings.knownDatabases.map(entry => entry.name)).toEqual(['A', 'B']);
  expect(api.AppendBatch).not.toHaveBeenCalled();
}, 20_000);

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

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('supports ranges, additive ranges, Ctrl/Meta toggles and context selection in %s', async view => {
  vi.mocked(api.GetEvents).mockResolvedValue(groupHistory);
  await mount();
  await chooseView(view);
  const ids = ['26-101', '26-102', '26-103', '26-104'];
  if (view === 'Netzplan') {
    // Lane packing can change the visible range when the network wraps.
    const card = (id: string) => element.querySelector<HTMLElement>(`[data-task-drag="${id}"]`)!.style;
    ids.sort((a, b) => parseFloat(card(a).top) - parseFloat(card(b).top)
      || parseFloat(card(a).left) - parseFloat(card(b).left));
  }
  const [first, second, third, fourth] = ids;
  selectTask(first);
  selectTask(third, { shiftKey: true });
  expect(selectedIds()).toEqual([first, second, third].sort());
  selectTask(second, { ctrlKey: true });
  expect(selectedIds()).toEqual([first, third].sort());
  selectTask(fourth, { metaKey: true, shiftKey: true });
  expect(selectedIds()).toEqual([...ids].sort());
  selectTask(fourth, { metaKey: true });
  expect(selectedIds()).toEqual([first, second, third].sort());
  act(() => element.querySelector(`[data-task-drag="${second}"]`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  expect(selectedIds()).toEqual([first, second, third].sort());
  key('Escape');
  act(() => element.querySelector(`[data-task-drag="${fourth}"]`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  expect(selectedIds()).toEqual([fourth]);
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
  expect(commands.map(command => [command.type, commandTaskId(command)])).toEqual([
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
  expect(api.AppendBatch).toHaveBeenCalledOnce(); expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
  await act(async () => key('m', document.body, { ctrlKey: true }));
  vi.mocked(api.GetEvents).mockResolvedValue([...history, { seq: 3, id: 'done', timestamp: date, undone: false,
    type: 'TASK_COMPLETED', payload: { taskId: '26-101', completedAt: date } }]);
  await act(async () => root.render(<App key="completed-check" />));
  selectTask('26-101');
  await act(async () => key('+', document.body, { ctrlKey: true }));
  expect(api.AppendBatch).toHaveBeenCalledOnce();
});

it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('freezes the drag group and links every member to the target in one batch in %s', async view => {
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

it.each(['Liste', 'Protokoll'].flatMap(view => ['date', 'resubmit', 'complete'].map(route => [view, route])))('applies %s %s drops to the frozen group, not the later selection', async (view, route) => {
  vi.mocked(api.GetEvents).mockResolvedValue(groupHistory);
  vi.mocked(api.AppendBatch).mockResolvedValue(groupHistory);
  await mount(); await chooseView(view); selectTask('26-101'); selectTask('26-102', { ctrlKey: true });
  dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
  selectTask('26-104');
  const target = route === 'date' ? element.querySelector('[data-flip-key^="date:"]')!
    : route === 'resubmit' ? element.querySelector('aside .cursor-pointer')!
    : element.querySelector('aside .flex-1.min-h-0')!;
  await act(async () => dragEvent(target, 'drop'));
  expect(api.AppendBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0].map(command => commandTaskId(command))).toEqual(['26-101', '26-102']);
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
  expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
  await act(async () => key(',', document.body, { ctrlKey: true }));
  expect(api.SetWindowMode).toHaveBeenCalledWith('window');
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

it('keeps caption double-click maximization separate from caption buttons', async () => {
  await mount();
  await act(async () => element.querySelector('[data-app-title-bar]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
  expect(api.ToggleWindowMaximized).toHaveBeenCalledOnce();
  await act(async () => button('In die Taskleiste minimieren').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(api.ToggleWindowMaximized).toHaveBeenCalledOnce();
});

it('opens protocol task details and keeps selection while navigating repeated occurrences with arrow keys', async () => {
  const later = '2026-10-19T09:00:00Z';
  vi.mocked(api.GetEvents).mockResolvedValue([...history, {
    seq: 3, id: 'later-note', timestamp: later, undone: false, type: 'TASK_LOG_ADDED',
    payload: { taskId: '26-101', entryId: 'note', text: 'Later work', createdAt: later },
  }]);
  await mount(); key('4', document.body, { ctrlKey: true });
  const protocol = element.querySelector('[data-protocol-view]')!;
  expect(protocol).not.toBeNull();
  click(protocol.querySelector('[data-task-drag="26-101"]')!);
  key('ArrowDown');
  expect(protocol.querySelector('[data-task-drag="26-102"][data-task-selected="true"]')).not.toBeNull();
  key('ArrowDown');
  expect(protocol.querySelector('[data-task-drag="26-101"][data-task-selected="true"]')).not.toBeNull();
  key('ArrowDown'); // At the end, retaining the same task must not toggle selection off.
  expect(protocol.querySelector('[data-task-drag="26-101"][data-task-selected="true"]')).not.toBeNull();
  const action = [...protocol.querySelectorAll('[data-protocol-row="action"]')].find(row => row.textContent?.includes('Later work'))!;
  act(() => action.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(element.querySelector('[data-task-detail-panel]')?.textContent).toContain('Later work');
});

it('keeps independent view positions and applies first-visit defaults only once', async () => {
  await mount();
  const scroll = element.querySelector('main')!;
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => {
    const protocol = scroll.querySelector<HTMLElement>('[data-protocol-view]');
    return protocol ? Number.parseFloat(protocol.style.height) : 2000;
  } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-protocol-view') ? -scroll.scrollTop : 0;
    return { top, left: 0, right: 900, bottom: top + 100, width: 900, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });
  const change = async (label: string) => { await act(async () => click(textButton(label))); };
  expect(scroll.scrollTop).toBe(0);
  await change('Protokoll');
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  expect(scroll.scrollTop).toBeGreaterThan(0);
  await change('Liste'); expect(scroll.scrollTop).toBe(0);
  scroll.scrollTop = 310;
  await change('Netzplan'); expect(scroll.scrollTop).toBe(0);
  scroll.scrollTop = 420;
  await change('Gantt'); expect(scroll.scrollLeft).toBe(0); expect(scroll.scrollTop).toBe(0);
  scroll.scrollLeft = 650; scroll.scrollTop = 70;
  await change('Protokoll');
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  act(() => { scroll.scrollTop = 30; scroll.dispatchEvent(new Event('scroll')); });
  await change('Liste'); expect(scroll.scrollTop).toBe(310); expect(scroll.scrollLeft).toBe(0);
  await change('Netzplan'); expect(scroll.scrollTop).toBe(420);
  await change('Gantt'); expect(scroll.scrollLeft).toBe(650); expect(scroll.scrollTop).toBe(70);
  await change('Protokoll'); expect(scroll.scrollTop).toBe(30); expect(scroll.scrollLeft).toBe(0);
  act(() => { scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); });
  await change('Liste'); await change('Protokoll'); expect(scroll.scrollTop).toBe(0);
});

// Timeline tests use the actual pointer adapter and mutation queue. The mock
// backend returns immutable event snapshots, including atomic undo groups.
function timelineFixture(defaults?: number[]) {
 const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(9, 0, 0, 0);
 const dateKey = toDateKey(day);
 let saved: StoredEvent[] = ['A', 'B', 'C', 'D'].map((title, index) => ({
   seq: index + 1, id: `timeline-${index}`, timestamp: new Date().toISOString(), undone: false,
   type: 'TASK_CREATED', payload: { taskId: `26-${101 + index}`, title, configuredStart: day.toISOString(), createdAt: new Date().toISOString() },
 }));
 if (defaults) activeSettings.defaultTimeMarkers = defaults;
 vi.mocked(api.GetEvents).mockImplementation(async () => saved);
 vi.mocked(api.AppendBatch).mockImplementation(async commands => {
   const groupId = `group-${saved.length}`;
   saved = [...saved, ...commands.map((command, index) => ({ ...command, seq: saved.length + index + 1,
     groupId, timestamp: new Date().toISOString(), undone: false } as StoredEvent))];
   return saved;
 });
 vi.mocked(api.Undo).mockImplementation(async () => {
   const last = [...saved].reverse().find(event => !event.undone && event.type !== 'TIME_DAY_INITIALIZED');
   saved = saved.map(event => event.groupId && event.groupId === last?.groupId ? { ...event, undone: true } : event);
   return saved;
 });
 return { dateKey, events: () => saved, state: () => projectEvents(saved, new Date()) };
}
it('creates a time marker at the pointer gap, binds its suffix, edits with nonmodal correction and deletes with undo', async () => {
 const fixture = timelineFixture([1200]); await mount();
 const date = element.querySelector(`[data-task-drag="marker:date:${fixture.dateKey}"]`)!;
 dragEvent(date, 'dragstart');
 const gap = element.querySelector('[data-task-insertion="insert:26-102:before"]')!;
 await act(async () => dragEvent(gap, 'drop'));
 let marker = [...fixture.state().timeline.markers.values()].find(item => item.id.startsWith('marker-'))!;
 expect(marker.minute).toBe(660); // One of four tasks before the gap: 08:00 + 12h / 4.
 expect(fixture.state().tasks['26-101'].timeMarkerId).toBeUndefined();
 for (const id of ['26-102', '26-103', '26-104']) {
   expect(fixture.state().tasks[id].timeMarkerId).toBe(marker.id);
   expect(new Date(fixture.state().tasks[id].configuredStart).getHours()).toBe(9);
 }
 const row = () => element.querySelector<HTMLElement>(`[data-time-marker="time:${marker.id}"]`)!;
 act(() => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
 const editor = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 type(editor, '23:00');
 await act(async () => key('Enter', editor));
 marker = fixture.state().timeline.markers.get(marker.id)!;
 expect(marker.minute).toBe(1185);
 expect(element.querySelector('input[aria-label="Uhrzeitmarker"]')).toBeNull();
 expect(element.textContent).toContain('19:45');
 expect(element.textContent).toContain('begrenzt');
 expect(document.activeElement).toBe(row());
 await act(async () => key('Delete', document.activeElement!));
 expect(fixture.state().timeline.markers.get(marker.id)?.removed).toBe(true);
 expect(new Date(fixture.state().tasks['26-102'].effectiveStart).getHours()).toBe(9);
 await act(async () => key('z', document.body, { ctrlKey: true }));
 expect(fixture.state().timeline.markers.get(marker.id)?.removed).not.toBe(true);
 expect(row()).not.toBeNull();
});
it('uses a marker as a copy source, binds task drops and removes it by dropping on its own day', async () => {
 const fixture = timelineFixture([720, 900]); await mount();
 const source = element.querySelector(`[data-task-drag="marker:default-${fixture.dateKey}-720"]`)!;
 expect(source).not.toBeNull();
 dragEvent(source, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-task-insertion="insert:26-103:before"]')!, 'drop'));
 expect(fixture.state().timeline.markers.get(`default-${fixture.dateKey}-720`)?.removed).not.toBe(true);
 const created = [...fixture.state().timeline.markers.values()].find(marker => marker.dateKey === fixture.dateKey && !marker.id.startsWith('default-'))!;
 expect(created).toBeDefined();
 dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector(`[data-time-marker="time:${created.id}"]`)!, 'drop'));
 expect(fixture.state().tasks['26-101'].timeMarkerId).toBe(created.id);
 dragEvent(element.querySelector(`[data-task-drag="marker:${created.id}"]`)!, 'dragstart');
 await act(async () => dragEvent(element.querySelector(`[data-task-drag="marker:date:${fixture.dateKey}"]`)!, 'drop'));
 expect(fixture.state().timeline.markers.get(created.id)?.removed).toBe(true);
});
it('reorders by pointer insertion without creating dependencies and preserves the order across date drops', async () => {
 const fixture = timelineFixture(); await mount();
 dragEvent(element.querySelector('[data-task-drag="26-104"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-task-insertion="insert:26-102:before"]')!, 'drop'));
 expect(fixture.state().openTasks.map(task => task.id)).toEqual(['26-101', '26-104', '26-102', '26-103']);
 expect(fixture.events().some(event => event.type === 'DEPENDENCY_ADDED')).toBe(false);
 for (const id of ['26-103', '26-101', '26-104', '26-102']) {
   dragEvent(element.querySelector(`[data-task-drag="${id}"]`)!, 'dragstart');
   await act(async () => dragEvent(element.querySelector(`[data-task-drag="marker:date:${toDateKey(new Date())}"]`)!, 'drop'));
 }
 expect(fixture.state().openTasks.map(task => task.id)).toEqual(['26-101', '26-104', '26-102', '26-103']);
});
it('retains an unsaved time-marker draft after a write failure and retries the same editor', async () => {
 const fixture = timelineFixture([720]); await mount();
 const id = `default-${fixture.dateKey}-720`;
 const row = element.querySelector(`[data-time-marker="time:${id}"]`)!;
 act(() => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
 const editor = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 type(editor, '13:00');
 vi.mocked(api.AppendBatch).mockRejectedValueOnce(new Error('Marker write failed'));
 await act(async () => key('Enter', editor));
 expect(editor.isConnected).toBe(true); expect(editor.value).toBe('13:00');
 expect(fixture.state().timeline.markers.get(id)?.minute).toBe(720);
 await act(async () => key('Enter', editor));
 expect(fixture.state().timeline.markers.get(id)?.minute).toBe(780);
 expect(element.querySelector('input[aria-label="Uhrzeitmarker"]')).toBeNull();
});

it('allows marker edits outside 08:00–20:00 and clamps only against actual neighbors', async () => {
 const fixture = timelineFixture([720]); await mount();
 const id = `default-${fixture.dateKey}-720`;
 const row = () => element.querySelector(`[data-time-marker="time:${id}"]`)!;
 for (const [value, minute] of [['23:00', 1380], ['06:00', 360]] as const) {
   act(() => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
   const editor = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
   type(editor, value); await act(async () => key('Enter', editor));
   expect(fixture.state().timeline.markers.get(id)?.minute).toBe(minute);
 }
});

it('keeps a time-marker editor mounted across expiration and releases it after saving', async () => {
 vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
 vi.setSystemTime(new Date(2026, 10, 11, 11, 59));
 const fixture = timelineFixture();
 const saved = fixture.events();
 saved.push({ seq: saved.length + 1, id: 'clock-marker', timestamp: new Date().toISOString(), undone: false,
   type: 'TIME_MARKER_CREATED', payload: { markerId: 'clock', dateKey: '2026-11-11', minute: 720 } });
 await mount();
 const row = () => element.querySelector('[data-time-marker="time:clock"]')!;
 act(() => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
 let editor = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 type(editor, '13:00');
 await act(async () => vi.advanceTimersByTime(120000));
 expect(editor.isConnected).toBe(true); expect(editor.value).toBe('13:00');
 await act(async () => key('Enter', editor));
 expect(fixture.state().timeline.markers.get('clock')?.minute).toBe(780);
 act(() => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
 editor = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 type(editor, '11:00'); await act(async () => key('Enter', editor));
 expect(row()).toBeNull();
 await act(async () => click(button('Kompaktansicht')));
 expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
});

it('moves configured days earlier while adopting the destination marker for insertion and direct marker drops', async () => {
 const fixture = timelineFixture();
 const saved = fixture.events(), later = new Date(); later.setDate(later.getDate() + 3); later.setHours(9, 0, 0, 0);
 const add = (command: import('./domain/eventSchema').EventCommand) => saved.push({ ...command,
   seq: saved.length + 1, id: `setup-${saved.length}`, timestamp: new Date().toISOString(), undone: false });
 for (const taskId of ['26-101', '26-103']) add({ type: 'TASK_START_DATE_SET', payload: { taskId, configuredStart: later.toISOString() } });
 add({ type: 'TIME_MARKER_CREATED', payload: { markerId: 'destination', dateKey: fixture.dateKey, minute: 840 } });
 add({ type: 'TASK_TIME_MARKER_SET', payload: { taskId: '26-102', markerId: 'destination' } });
 await mount();
 dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-task-insertion="insert:26-102:before"]')!, 'drop'));
 dragEvent(element.querySelector('[data-task-drag="26-103"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-time-marker="time:destination"]')!, 'drop'));
 for (const id of ['26-101', '26-103']) {
   const task = fixture.state().tasks[id];
   expect(toDateKey(new Date(task.configuredStart))).toBe(fixture.dateKey);
   expect(task.timeMarkerId).toBe('destination');
   expect(new Date(task.effectiveStart).getHours()).toBe(14);
 }
});

it('shows gross daily changes in the toolbar and the opening balance on protocol date dividers', async () => {
 const today = new Date(); today.setHours(9, 0, 0, 0);
 const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
 let saved: StoredEvent[] = ['A', 'B', 'D'].map((taskId, index) => ({
   seq: index + 1, id: `balance-${index}`, timestamp: (index < 2 ? yesterday : today).toISOString(), undone: false,
   type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: today.toISOString(), createdAt: (index < 2 ? yesterday : today).toISOString() },
 }));
 saved.push({ seq: 4, id: 'done-balance', timestamp: today.toISOString(), undone: false, type: 'TASK_COMPLETED', payload: { taskId: 'A', completedAt: today.toISOString() } });
 vi.mocked(api.GetEvents).mockImplementation(async () => saved);
 vi.mocked(api.Undo).mockImplementation(async () => { saved = saved.map(event => event.id === 'done-balance' ? { ...event, undone: true } : event); return saved; });
 await mount();
 const current = () => element.querySelector('[data-task-balance="current"]')!.textContent;
 expect(current()).toBe('+1 -1 = 2');
 await chooseView('Protokoll');
 const opening = () => element.querySelector(`[data-protocol-key="date:${toDateKey(today)}"] [data-task-balance="opening"]`)!.textContent;
 expect(opening()).toBe('2 +1 -1');
 await act(async () => key('z', document.body, { ctrlKey: true }));
 expect(current()).toBe('+1 -0 = 3');
 expect(opening()).toBe('2 +1 -0');
});

it('does not bind an insertion in the current unslotted area to an expired midnight marker', async () => {
 const fixture = timelineFixture([0]);
 const today = new Date(); today.setHours(9, 0, 0, 0);
 const saved = fixture.events();
 saved.push({ seq: saved.length + 1, id: 'move-target-today', timestamp: new Date().toISOString(), undone: false,
   type: 'TASK_START_DATE_SET', payload: { taskId: '26-102', configuredStart: today.toISOString() } });
 await mount();
 dragEvent(element.querySelector('[data-task-drag="26-101"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-task-insertion="insert:26-102:before"]')!, 'drop'));
 expect(fixture.state().tasks['26-101'].timeMarkerId).toBeUndefined();
 expect(fixture.state().tasks['26-101'].effectiveStart).toBe(today.toISOString());
});

it('creates a future marker today even after the nominal 20:00 boundary', async () => {
 vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
 vi.setSystemTime(new Date(2026, 10, 11, 20, 30));
 const fixture = timelineFixture();
 for (const event of fixture.events()) {
   if (event.type === 'TASK_CREATED') event.payload.configuredStart = new Date(2026, 10, 11, 9).toISOString();
 }
 await mount();
 dragEvent(element.querySelector('[data-task-drag="marker:date:2026-11-11"]')!, 'dragstart');
 await act(async () => dragEvent(element.querySelector('[data-task-insertion="insert:26-102:before"]')!, 'drop'));
 const marker = [...fixture.state().timeline.markers.values()].find(item => item.id.startsWith('marker-'))!;
 expect(marker.minute).toBe(1260);
 expect(element.querySelector(`[data-time-marker="time:${marker.id}"]`)).not.toBeNull();
 expect(new Date(fixture.state().tasks['26-102'].effectiveStart).getHours()).toBe(21);
});

it('excludes active tasks from marker insertion targets and the proportional time calculation', async () => {
 vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
 vi.setSystemTime(new Date(2026, 10, 11, 7));
 const fixture = timelineFixture();
 const saved = fixture.events();
 for (const event of saved) if (event.type === 'TASK_CREATED') event.payload.configuredStart = new Date(2026, 10, 11, 9).toISOString();
 const add = (command: import('./domain/eventSchema').EventCommand) => saved.push({ ...command,
   seq: saved.length + 1, id: `active-setup-${saved.length}`, timestamp: new Date().toISOString(), undone: false });
 for (const taskId of ['26-105', '26-106']) {
   add({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: new Date(2026, 10, 11, 9).toISOString(), createdAt: new Date().toISOString() } });
   add({ type: 'TASK_ACTIVE_SET', payload: { taskId, isActive: true } });
 }
 await mount();
 dragEvent(element.querySelector('[data-task-drag="marker:date:2026-11-11"]')!, 'dragstart');
 for (const id of ['26-105', '26-106']) {
   expect(element.querySelector(`[data-task-insertion="insert:${id}:before"]`)!.hasAttribute('data-task-drop-target')).toBe(false);
 }
 const gap = element.querySelector('[data-task-insertion="insert:26-102:before"]')!;
 dragEvent(gap, 'dragover');
 expect(gap.getAttribute('data-insertion-active')).toBe('true');
 await act(async () => dragEvent(gap, 'drop'));
 const marker = [...fixture.state().timeline.markers.values()].find(item => item.id.startsWith('marker-'))!;
 expect(marker.minute).toBe(660); // One of four inactive tasks before the gap; the two active tasks do not count.
 expect(fixture.state().tasks['26-105'].timeMarkerId).toBeUndefined();
 expect(fixture.state().tasks['26-106'].timeMarkerId).toBeUndefined();
 expect(fixture.state().tasks['26-102'].timeMarkerId).toBe(marker.id);
});

it('retains usable marker selection after unchanged Enter and Escape without stealing focus on blur', async () => {
 const fixture = timelineFixture([720]); await mount();
 const id = `default-${fixture.dateKey}-720`;
 const row = () => element.querySelector(`[data-time-marker="time:${id}"]`)!;
 const edit = () => {
   act(() => row().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
   return element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 };
 const unchangedEditor = edit();
 await act(async () => key('Enter', unchangedEditor));
 expect(document.activeElement).toBe(row());
 key('F2', document.activeElement!);
 const draft = element.querySelector<HTMLInputElement>('input[aria-label="Uhrzeitmarker"]')!;
 type(draft, '15:00'); key('Escape', draft);
 expect(document.activeElement).toBe(row());
 expect(fixture.state().timeline.markers.get(id)?.minute).toBe(720);
 const editor = edit(); type(editor, '13:00');
 const other = element.querySelector<HTMLInputElement>('header input')!;
 await act(async () => other.focus());
 expect(document.activeElement).toBe(other);
 expect(fixture.state().timeline.markers.get(id)?.minute).toBe(780);
 // Regain marker focus through the keyboard, then delete without another click.
 const finalEditor = edit();
 await act(async () => key('Enter', finalEditor));
 await act(async () => key('Delete', document.activeElement!));
 expect(fixture.state().timeline.markers.get(id)?.removed).toBe(true);
});

const copySummaryId = 'copy-task-summary';
const copySummary = () => textButton(t('Task-Zusammenfassung kopieren'));
const pluginSwitch = () => Array.from(element.querySelectorAll<HTMLButtonElement>('button[role="switch"]')).find(control =>
  document.getElementById(control.getAttribute('aria-labelledby') ?? '')?.textContent === t('Task-Zusammenfassung kopieren'))!;
function activatePluginSwitch(by: 'Enter' | ' ') {
  const control = pluginSwitch();
  // jsdom does not provide the native button activation default. Make sure
  // DoDrag does not consume either key, then deliver the resulting click.
  const event = new KeyboardEvent('keydown', { key: by, bubbles: true, cancelable: true });
  act(() => { control.focus(); if (control.dispatchEvent(event)) control.click(); });
  expect(event.defaultPrevented).toBe(false);
}

it('keeps the checked flag and detail contribution at their last confirmed values until saving succeeds', async () => {
  activeSettings.pluginEnabled = { [copySummaryId]: false };
  const enable = deferred<AppSettings>();
  api.SetPluginEnabled = vi.fn(() => enable.promise);
  await mount(); selectTask('26-101'); click(button(t('Details anzeigen')));
  const editor = element.querySelector('.tiptap');
  expect(editor).not.toBeNull();
  await openSettings();
  const control = pluginSwitch();
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).not.toBe('');
  activatePluginSwitch('Enter');
  activatePluginSwitch(' ');
  expect(api.SetPluginEnabled).toHaveBeenCalledOnce();
  expect(api.SetPluginEnabled).toHaveBeenCalledWith(copySummaryId, true);
  expect(document.activeElement).toBe(control);
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(control.getAttribute('aria-disabled')).toBe('true');
  expect(textButton('Verwenden').disabled).toBe(true);
  expect(copySummary()).toBeUndefined();
  await act(async () => enable.resolve(activeSettings = { ...activeSettings, pluginEnabled: { [copySummaryId]: true } }));
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(control.getAttribute('aria-disabled')).toBe('false');
  expect(document.activeElement).toBe(control);
  expect(copySummary().disabled).toBe(true);
  const failure = deferred<AppSettings>();
  vi.mocked(api.SetPluginEnabled).mockReturnValueOnce(failure.promise);
  activatePluginSwitch(' ');
  expect(api.SetPluginEnabled).toHaveBeenLastCalledWith(copySummaryId, false);
  await act(async () => failure.reject(new Error('fixture save error')));
  expect(element.querySelector('[role="alert"]')?.textContent).toContain('fixture save error');
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(control);
  vi.mocked(api.SetPluginEnabled).mockResolvedValueOnce({ ...activeSettings, pluginEnabled: { [copySummaryId]: false } });
  await act(async () => activatePluginSwitch('Enter'));
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(copySummary()).toBeUndefined();
  expect(element.querySelector('[role="alert"]')).toBeNull();
  click(textButton('Fertig'));
  expect(element.querySelector('.tiptap')).toBe(editor);
  expect(api.GetEvents).toHaveBeenCalledTimes(1);
  expect(api.AppendBatch).not.toHaveBeenCalled();
  expect(api.AppendEvent).not.toHaveBeenCalled();
});

it('blocks plugin setting changes while refreshing Settings and makes them available without an open database', async () => {
  activeSettings = { ...settings, databaseReady: false, pluginEnabled: { [copySummaryId]: false } };
  api.SetPluginEnabled = vi.fn(async () => (activeSettings = { ...activeSettings, pluginEnabled: { [copySummaryId]: true } }));
  await mount();
  const refresh = deferred<AppSettings>();
  vi.mocked(api.GetSettings).mockReturnValueOnce(refresh.promise);
  click(textButton(t('Aktive Datenbank erneut laden')));
  expect(pluginSwitch().getAttribute('aria-disabled')).toBe('true');
  activatePluginSwitch('Enter');
  expect(api.SetPluginEnabled).not.toHaveBeenCalled();
  // Recovery here fails to reopen a database, but finishes the settings refresh.
  vi.mocked(api.SwitchDatabase).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => refresh.resolve(activeSettings));
  expect(pluginSwitch().getAttribute('aria-disabled')).toBe('false');
  await act(async () => activatePluginSwitch(' '));
  expect(pluginSwitch().getAttribute('aria-checked')).toBe('true');
  expect(api.GetEvents).not.toHaveBeenCalled();
  expect(copySummary()).toBeUndefined();
});

it('limits the copy action to visible normal-mode task details and ignores late feedback after task or database changes', async () => {
  activeSettings.pluginEnabled = { [copySummaryId]: true };
  const first = deferred<void>(), second = deferred<void>();
  const clipboard = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  const project: StoredEvent = { seq: 3, id: 'project', timestamp: date, undone: false, type: 'PROJECT_SAVED',
    payload: { projectId: 'P1', code: 'P1', color: '#334455', summary: '', description: '' } };
  vi.mocked(api.GetEvents).mockResolvedValue([...history, project]);
  try {
    await mount();
    click(button(t('Details anzeigen')));
    expect(copySummary()).toBeUndefined();
    selectTask('26-101');
    const alpha = copySummary();
    click(alpha);
    expect(clipboard).toHaveBeenCalledOnce();
    selectTask('26-102');
    click(alpha);
    await act(async () => first.resolve());
    expect(clipboard).toHaveBeenCalledOnce();
    expect(element.textContent).not.toContain(t('Task-Zusammenfassung kopiert.'));
    click(button(t('Details schließen')));
    expect(copySummary()).toBeUndefined();
    click(button(t('Details anzeigen')));
    await act(async () => element.querySelector('[data-project-drag="P1"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(element.querySelector('[data-project-details]')).not.toBeNull();
    expect(copySummary()).toBeUndefined();
    selectTask('26-102');
    const beta = copySummary();
    await openSettings();
    expect(beta.disabled).toBe(true);
    click(beta);
    expect(clipboard).toHaveBeenCalledOnce();
    click(textButton('Fertig'));
    click(beta);
    expect(clipboard).toHaveBeenCalledTimes(2);
    await openSettings();
    await act(async () => click(textButton('Verwenden')));
    await act(async () => second.reject(new Error('stale clipboard failure')));
    expect(element.textContent).not.toContain('stale clipboard failure');
    click(textButton('Fertig'));
    expect(copySummary()).toBeUndefined();
    activeSettings.pluginEnabled = { [copySummaryId]: true };
    await openSettings(); click(textButton('Fertig'));
    selectTask('26-101');
    expect(copySummary()).toBeDefined();
    await act(async () => key('m', document.body, { ctrlKey: true }));
    expect(button('Fenster')).not.toBeNull();
    expect(copySummary()).toBeUndefined();
    expect(api.AppendBatch).not.toHaveBeenCalled();
    expect(api.AppendEvent).not.toHaveBeenCalled();
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

function timeMeasurementFixture() {
  activeSettings = { ...activeSettings, databaseGeneration: 42, pluginEnabled: { 'time-measurement': true } };
  const startMs = Date.parse(date);
  const session: TimeMeasurementSession = {
    id: 17, taskId: '26-101', taskCreationEventId: history[0].id, startMs, endMs: null, elapsedMs: null,
  };
  const empty: TimeMeasurementState = { running: null, interrupted: null, sessions: [], discarded: false };
  const saved = { ...session, endMs: startMs + 90_000, elapsedMs: 90_000 };
  let confirmed = empty;
  api.GetTimeMeasurement = vi.fn(async () => confirmed);
  return { empty, session, saved, setConfirmed: (value: TimeMeasurementState) => { confirmed = value; return value; } };
}

it('shows elapsed time and starts or stops tracking from the overview toolbar', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(session.startMs);
  api.StartTimeMeasurement = vi.fn(async () => setConfirmed({ ...empty, running: session }));
  api.StopTimeMeasurement = vi.fn(async () => setConfirmed(empty));
  const control = (label: string) => element.querySelector<HTMLButtonElement>(`header button[aria-label="${label}"]`)!;
  const start = () => control(t('Messung starten'));
  const stop = () => control(t('Messung stoppen'));
  await mount();
  expect(start().disabled).toBe(true);
  selectTask('26-101');
  await act(async () => click(start()));
  expect(api.StartTimeMeasurement).toHaveBeenCalledWith(42, '26-101', history[0].id);
  await act(async () => vi.advanceTimersByTime(31_000));
  expect(stop().textContent).toContain('00:00:31');
  selectTask('26-102');
  expect(stop().textContent).toContain('Alpha');
  expect(stop().textContent).not.toContain('Beta');
  await act(async () => click(stop()));
  expect(api.StopTimeMeasurement).toHaveBeenCalledWith(42, session.id);
  expect(start().textContent).toContain('00:00:00');
  expect(start().textContent).toContain('Beta');
});

it('starts and hands off timers directly beside the task row Activate button', async () => {
  const { empty, session, saved, setConfirmed } = timeMeasurementFixture();
  const second = { ...session, id: 18, taskId: '26-102', taskCreationEventId: history[1].id };
  const earlier = { ...saved, id: 19, startMs: session.startMs - 30_000, endMs: session.startMs, elapsedMs: 30_000 };
  const savedSecond = { ...second, endMs: second.startMs + 45_000, elapsedMs: 45_000 };
  const state = setConfirmed({ ...empty, sessions: [saved, earlier, { ...saved, id: 20, taskCreationEventId: 'old-task' }] });
  api.StartTimeMeasurement = vi.fn(async (_generation, taskId) => setConfirmed({ ...state, running: taskId === session.taskId ? session : second }));
  api.StopTimeMeasurement = vi.fn(async () => setConfirmed({ ...state, sessions: [...state.sessions, savedSecond] }));
  const timerByActivate = (id: string) => element.querySelector(`main [data-source-task-id="${id}"] button[title="${t('Aktivieren (Space)')}"]`)!.nextElementSibling!;
  await mount();
  expect(timerByActivate(session.taskId).getAttribute('aria-label')).toBe(t('Messung starten'));
  expect(timerByActivate(session.taskId).textContent).toBe('00:02:00');
  await act(async () => click(timerByActivate(session.taskId)));
  expect(api.StartTimeMeasurement).toHaveBeenCalledWith(42, session.taskId, history[0].id);
  expect(timerByActivate(session.taskId).getAttribute('aria-label')).toBe(t('Messung stoppen'));
  expect(timerByActivate(session.taskId).textContent).toBe('00:02:00');
  await act(async () => click(timerByActivate(second.taskId)));
  expect(api.StartTimeMeasurement).toHaveBeenLastCalledWith(42, second.taskId, history[1].id);
  expect(timerByActivate(session.taskId).getAttribute('aria-label')).toBe(t('Messung starten'));
  expect(timerByActivate(second.taskId).textContent).toBe('00:00:00');
  await act(async () => click(timerByActivate(second.taskId)));
  expect(api.StopTimeMeasurement).toHaveBeenCalledWith(42, second.id);
  expect(timerByActivate(second.taskId).textContent).toBe('00:00:45');
});

it('keeps the confirmed running timer on a failed handoff and can stop it from compact mode', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  const firstStart = deferred<TimeMeasurementState>();
  api.StartTimeMeasurement = vi.fn().mockReturnValueOnce(firstStart.promise).mockRejectedValueOnce(new Error('handoff rejected'));
  api.StopTimeMeasurement = vi.fn(async () => setConfirmed({ ...empty, discarded: true }));
  await mount();
  selectTask('26-101'); click(button(t('Details anzeigen')));
  await act(async () => click(textButton(t('Messung starten'))));
  expect(api.StartTimeMeasurement).toHaveBeenCalledWith(42, '26-101', history[0].id);
  expect(textButton(t('Messung starten')).disabled).toBe(true);
  expect(textButton(t('Messung stoppen'))).toBeUndefined();
  await act(async () => firstStart.resolve(setConfirmed({ ...empty, running: session })));
  expect(textButton(t('Messung stoppen')).closest('[data-task-detail-panel]')).not.toBeNull();
  selectTask('26-102');
  expect(textButton(t('Messung stoppen')).closest('[data-task-detail-panel]')).toBeNull();
  await act(async () => click(textButton(t('Messung starten'))));
  expect(api.StartTimeMeasurement).toHaveBeenLastCalledWith(42, '26-102', history[1].id);
  expect(element.textContent).toContain('handoff rejected');
  expect(element.textContent).toContain(t('Laufende Messung: {task}', { task: 'Alpha' }));
  click(button(t('Details schließen')));
  expect(textButton(t('Messung stoppen'))).toBeDefined();
  await act(async () => click(button('Kompaktansicht')));
  expect(api.SetWindowMode).toHaveBeenCalledWith('mini');
  await act(async () => click(textButton(t('Messung stoppen'))));
  expect(api.StopTimeMeasurement).toHaveBeenCalledWith(42, session.id);
  expect(element.textContent).toContain(t('Messung unter 30 Sekunden wurde verworfen.'));
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('offers recovery for an interrupted timer without a visible task and waits for confirmation', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  const interrupted = { ...session, taskId: '26-999' };
  setConfirmed({ ...empty, interrupted });
  api.RecoverTimeMeasurement = vi.fn()
    .mockRejectedValueOnce(new Error('recovery rejected'))
    .mockImplementationOnce(async () => setConfirmed(empty));
  await mount();
  selectTask('26-101'); click(button(t('Details anzeigen')));
  expect(textButton(t('Messung starten')).disabled).toBe(true);
  click(textButton(t('Endzeit wählen')));
  const input = element.querySelector<HTMLInputElement>('form input[placeholder$="Z"]')!;
  expect(input.value).toBe('');
  expect(input.placeholder).toBe(new Date(interrupted.startMs).toISOString().replace('.000Z', 'Z'));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-10-17T09:01:00Z');
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.RecoverTimeMeasurement).toHaveBeenCalledWith(42, session.id, Date.parse('2026-10-17T09:01:00Z'), false);
  expect(element.textContent).toContain('recovery rejected');
  expect(textButton(t('Messung starten')).disabled).toBe(true);
  await act(async () => click(textButton(t('Messung verwerfen'))));
  expect(api.RecoverTimeMeasurement).toHaveBeenLastCalledWith(42, session.id, 0, true);
  expect(textButton(t('Messung starten')).disabled).toBe(false);
});

it('uses creation identity for timer history, edits the end, and requires separate delete confirmation', async () => {
  const { empty, saved, setConfirmed } = timeMeasurementFixture();
  const old = { ...saved, id: saved.id + 1, taskCreationEventId: 'old-alpha', elapsedMs: 100_000 };
  setConfirmed({ ...empty, sessions: [saved, old] });
  api.UpdateTimeMeasurementEnd = vi.fn(async (_generation, _id, endMs) => setConfirmed({
    ...empty, sessions: [{ ...saved, endMs, elapsedMs: endMs - saved.startMs }, old],
  }));
  api.DeleteTimeMeasurementSession = vi.fn(async () => setConfirmed({ ...empty, sessions: [old] }));
  await mount();
  selectTask('26-101'); click(button(t('Details anzeigen')));
  expect(element.textContent).toContain(t('Gespeicherte Zeit: {duration}', { duration: '00:01:30' }));
  const panel = element.querySelector<HTMLElement>(`section[aria-label="${t('Zeiterfassung')}"]`)!;
  act(() => { panel.querySelector('details')!.open = true; });
  expect(panel.querySelectorAll('li')).toHaveLength(1);
  click(textButton(t('Endzeit ändern')));
  const endInput = panel.querySelector('input')!;
  const endMs = saved.startMs + 120_000;
  type(endInput, new Date(endMs).toISOString());
  await act(async () => endInput.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.UpdateTimeMeasurementEnd).toHaveBeenCalledWith(42, saved.id, endMs);
  expect(panel.textContent).toContain(t('Gespeicherte Zeit: {duration}', { duration: '00:02:00' }));
  click(textButton(t('Sitzung löschen')));
  expect(api.DeleteTimeMeasurementSession).not.toHaveBeenCalled();
  await act(async () => click(textButton(t('löschen'))));
  expect(api.DeleteTimeMeasurementSession).toHaveBeenCalledWith(42, saved.id);
  expect(panel.querySelectorAll('li')).toHaveLength(0);
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it.each(['disabled', 'no database'])('does not load time measurement when %s', async mode => {
  timeMeasurementFixture();
  if (mode === 'disabled') activeSettings.pluginEnabled = { 'time-measurement': false };
  else activeSettings.databaseReady = false;
  await mount();
  expect(api.GetTimeMeasurement).not.toHaveBeenCalled();
  expect(element.querySelector(`header button[aria-label="${t('Messung starten')}"]`)).toBeNull();
  expect(textButton(t('Messung starten'))).toBeUndefined();
});

it('refreshes the original database after stopping succeeded but switch failed', async () => {
  const { empty, session, saved, setConfirmed } = timeMeasurementFixture();
  setConfirmed({ ...empty, running: session });
  vi.mocked(api.SwitchDatabase).mockImplementationOnce(async () => {
    setConfirmed({ ...empty, sessions: [saved] });
    throw new Error('settings could not persist');
  });
  await mount();
  expect(textButton(t('Messung stoppen'))).toBeDefined();
  await openSettings();
  await act(async () => click(textButton('Verwenden')));
  expect(activeSettings.activeDatabasePath).toBe('A.db');
  expect(api.GetTimeMeasurement).toHaveBeenLastCalledWith(42);
  expect(textButton(t('Messung stoppen'))).toBeUndefined();
  expect(element.textContent).toContain('settings could not persist');
  click(textButton('Fertig'));
  selectTask('26-101'); click(button(t('Details anzeigen')));
  expect(element.textContent).toContain(t('Gespeicherte Zeit: {duration}', { duration: '00:01:30' }));
});

it('refreshes the stopped state even when saving plugin disable fails', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  setConfirmed({ ...empty, running: session });
  api.SetPluginEnabled = vi.fn(async () => {
    setConfirmed(empty);
    throw new Error('disable did not persist');
  });
  await mount();
  await openSettings();
  const control = Array.from(element.querySelectorAll<HTMLButtonElement>('button[role="switch"]')).find(node =>
    document.getElementById(node.getAttribute('aria-labelledby') ?? '')?.textContent === t('Zeiterfassung'))!;
  await act(async () => click(control));
  expect(api.SetPluginEnabled).toHaveBeenCalledWith('time-measurement', false);
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(textButton(t('Messung stoppen'))).toBeUndefined();
  expect(element.textContent).toContain('disable did not persist');
});

it('does not publish an overdue timer read after database generation changes', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  const oldReply = deferred<TimeMeasurementState>();
  vi.mocked(api.GetTimeMeasurement!).mockReturnValueOnce(oldReply.promise);
  vi.mocked(api.SwitchDatabase).mockImplementationOnce(async path => {
    activeSettings = { ...activeSettings, activeDatabasePath: path, databaseGeneration: 43 };
    setConfirmed({ ...empty, sessions: [] });
    return activeSettings;
  });
  await mount();
  expect(api.GetTimeMeasurement).toHaveBeenCalledWith(42);
  await openSettings();
  await act(async () => click(textButton('Verwenden')));
  expect(api.GetTimeMeasurement).toHaveBeenLastCalledWith(43);
  await act(async () => oldReply.resolve({ ...empty, running: session }));
  expect(textButton(t('Messung stoppen'))).toBeUndefined();
});

it('restores interaction and the running timer when native close cannot stop it', async () => {
  const { empty, session, setConfirmed } = timeMeasurementFixture();
  setConfirmed({ ...empty, running: session });
  const events = new Map<string, (...args: unknown[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  vi.mocked(api.FinishClose!).mockRejectedValueOnce(new Error('native stop rejected'));
  await mount();
  await act(async () => events.get('app:before-close')!());
  expect(api.FinishClose).toHaveBeenNthCalledWith(1, true);
  expect(document.body.inert).not.toBe(true);
  expect(api.GetTimeMeasurement).toHaveBeenCalledTimes(2);
  expect(textButton(t('Messung stoppen')).disabled).toBe(false);
  expect(element.textContent).toContain('native stop rejected');
});
