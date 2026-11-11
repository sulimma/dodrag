// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { allowWindowPaint } from './hooks/useWindowPresentation';
import type { AppSettings } from './bridge/eventBridge';
import type { StoredEvent } from './domain/types';
import { setLanguage, t } from './i18n';

// jsdom has no compositor; frame scheduling is verified by the hook tests.
vi.mock('./hooks/useWindowPresentation', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useWindowPresentation')>(),
  allowWindowPaint: vi.fn(async () => {}),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ initial, animate, exit, ...props }: any) => <div {...props} /> },
}));

const taskId = '26-101';
const date = '2026-10-25T09:00:00.000Z';
const settings: AppSettings = {
  activeDatabasePath: 'details.db', databaseReady: true, autostart: false,
  knownDatabases: [{ name: 'Details fixture', path: 'details.db', exists: true, isDemo: false }],
};
let host: HTMLDivElement, root: Root, history: StoredEvent[];
let api: NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  setLanguage('de');
  history = [{
    seq: 1, id: 'created-fixture', timestamp: date, undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: 'Alpha', configuredStart: date, createdAt: date },
  }];
  api = {
    SetEditorReady: vi.fn(async () => {}), FinishClose: vi.fn(async () => {}),
    GetSettings: vi.fn(async () => settings), GetEvents: vi.fn(async () => history),
    AppendBatch: vi.fn(async (commands: Parameters<NonNullable<typeof api>['AppendBatch']>[0]) => {
      history = [...history, ...commands.map((command, index) => ({
        ...command, seq: history.length + index + 1, timestamp: date, undone: false,
      }))];
      return history;
    }),
    AppendEvent: vi.fn(async () => history), Undo: vi.fn(async () => history), Redo: vi.fn(async () => history),
    SwitchDatabase: vi.fn(async () => settings), DeleteDatabase: vi.fn(async () => settings),
    CreateDatabase: vi.fn(async () => settings), OpenExistingDatabaseDialog: vi.fn(async () => settings),
    SetAutostart: vi.fn(async () => settings), SelectFolderDialog: vi.fn(async () => ''),
    GetWindowMaximized: vi.fn(async () => false), ToggleWindowMaximized: vi.fn(async () => {}),
    RequestWindowClose: vi.fn(async () => {}), ShowWindowSystemMenu: vi.fn(async () => {}),
    GetWindowMode: vi.fn(async () => 'window' as const), SetWindowMode: vi.fn(async (mode: 'taskbar' | 'mini' | 'window') => mode),
    ShowTaskContextMenu: vi.fn(async () => ''), UpdateMiniModeHeight: vi.fn(async () => {}),

  };
  api.ShowTaskContextMenuAt = api.ShowTaskContextMenu;
  window.go = { main: { App: api } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); delete window.go; delete window.runtime;
  setLanguage('de'); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const panel = () => host.querySelector<HTMLElement>(`aside[aria-label="${t('Task-Details')}"]`)!;
const list = () => host.querySelector<HTMLElement>('main')!;
const toggle = () => panel().querySelector<HTMLButtonElement>(':scope > button[data-detail-toggle]')!;
const click = (target: Element) => act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const key = async (target: Element, value: string) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  })); });
};
const type = (input: HTMLElement, value: string) => act(() => {
  if (input instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  else input.textContent = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const label = (kind: 'title' | 'date') => t(kind === 'title' ? 'Titel {id}' : 'Startdatum {id}', { id: taskId });
const editor = (area: Element, kind: 'title' | 'date') => area.querySelector<HTMLElement>(`${kind === 'title' ? '[data-task-title-editing="true"]' : 'input'}[aria-label="${label(kind)}"]`);


const omni = () => host.querySelector<HTMLInputElement>(`input[placeholder="${t('Neues kleines TODO eingeben... (Taste N)')}"]`)!;
const filter = () => host.querySelector<HTMLButtonElement>(`button[aria-label="${t('Tasks filtern')}"]`)!;
async function ctrlF(target: Element) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })); });
}
async function mountSearch() {
  history.push({ seq: history.length + 1, id: 'beta', timestamp: date, undone: false, type: 'TASK_CREATED', payload: { taskId: '26-102', title: 'Beta', configuredStart: date, createdAt: date } },
    { seq: history.length + 2, id: 'description', timestamp: date, undone: false, type: 'TASK_DESCRIPTION_SET', payload: { taskId: '26-102', description: 'Deep needle' } });
  await act(async () => root.render(<App />));
}
function submit() { return act(async () => { omni().form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

it('highlights while leaving all tasks visible until filtering, keeps details stable and resets with Escape', async () => {
  await mountSearch();
  click(list().querySelector(`[data-task-drag="${taskId}"]`)!); click(toggle());
  act(() => omni().focus()); type(omni(), 'needle');
  expect(list().querySelectorAll('[data-source-task-id]')).toHaveLength(2);
  click(filter());
  expect(document.activeElement).toBe(omni());
  expect(list().querySelectorAll('[data-source-task-id]')).toHaveLength(1);
  expect(list().querySelector('[data-task-drag="26-102"]')).not.toBeNull();
  expect(panel().textContent).toContain('Alpha');
  await key(omni(), 'Escape');
  expect(omni().value).toBe(''); expect(filter().getAttribute('aria-pressed')).toBe('false');
  expect(document.activeElement).not.toBe(omni());
  expect(list().querySelectorAll('[data-source-task-id]')).toHaveLength(2);
  expect(panel().textContent).toContain('Alpha');
});
it('Ctrl+F selects existing input from outside and toggles without disturbing the caret inside', async () => {
  await mountSearch(); type(omni(), 'Alpha');
  await ctrlF(list());
  expect(document.activeElement).toBe(omni());
  expect(omni().selectionStart).toBe(0); expect(omni().selectionEnd).toBe(5);
  expect(filter().getAttribute('aria-pressed')).toBe('true');
  act(() => omni().setSelectionRange(2, 2)); await ctrlF(omni());
  expect(filter().getAttribute('aria-pressed')).toBe('false'); expect(omni().selectionStart).toBe(2);
  await ctrlF(omni()); expect(filter().getAttribute('aria-pressed')).toBe('true');
  type(omni(), ''); expect(list().querySelectorAll('[data-source-task-id]')).toHaveLength(2);
});
it.each(['Liste', 'Netzplan', 'Gantt', 'Protokoll'])('filters %s by deep data and Enter skips draggable date dividers to open its first task match', async view => {
  await mountSearch();
  click(host.querySelector<HTMLButtonElement>(`button[title^="${view}"]`)!);
  type(omni(), 'needle'); click(filter());
  expect(list().querySelector('[data-task-drag="26-101"]')).toBeNull();
  expect(list().querySelector('[data-task-drag="26-102"]')).not.toBeNull();
  await submit();
  expect(panel().querySelector('header')?.textContent).toContain('Beta');
  expect(omni().value).toBe('needle'); expect(api.AppendBatch).not.toHaveBeenCalled();
  type(omni(), 'no match'); await submit();
  expect(panel().querySelector('header')?.textContent).toContain('Beta');
  expect(list().querySelector('[data-task-drag]')).toBeNull();
});
it('Enter creates outside filter mode and the explicit plus creates inside filter mode', async () => {
  await mountSearch(); type(omni(), 'New task'); await submit();
  expect(api.AppendBatch).toHaveBeenCalledTimes(1); expect(omni().value).toBe('');
  click(filter()); type(omni(), 'Explicit task');
  await act(async () => host.querySelector<HTMLButtonElement>(`button[title="${t('Task hinzufügen')}"]`)!.click());
  expect(api.AppendBatch).toHaveBeenCalledTimes(2); expect(omni().value).toBe('');
  expect(filter().getAttribute('aria-pressed')).toBe('true');
});
it('filters completed tasks and counts matches against the complete completed collection', async () => {
  history.push({ seq: 2, id: 'closed', timestamp: date, undone: false, type: 'TASK_COMPLETED', payload: { taskId, completedAt: date } });
  await mountSearch(); click(filter()); type(omni(), 'missing');
  const completed = host.querySelector('[data-task-drop-target="completed-list-dropzone"]')!;
  expect(completed.textContent).toContain('0 / 1'); expect(completed.querySelector('[data-completed-task]')).toBeNull();
  type(omni(), 'Alpha'); expect(completed.textContent).toContain('1 / 1');
  expect(completed.querySelector('[data-completed-task="26-101"]')).not.toBeNull();
  await key(omni(), 'Escape'); expect(completed.textContent).toContain('Erledigte Tasks (1)');
});

it('clears the query even when creation normalizes an overlong title', async () => {
  await mountSearch(); type(omni(), 'x'.repeat(2001)); await submit();
  expect(api.AppendBatch).toHaveBeenCalledTimes(1); expect(omni().value).toBe('');
});
it.each(['Netzplan', 'Gantt'])('removes dependencies to hidden tasks in %s and restores them on reset', async view => {
  const seq = history.length + 1;
  history.push({ seq, id: 'dependent', timestamp: date, undone: false, type: 'TASK_CREATED', payload: { taskId: '26-103', title: 'Gamma', configuredStart: date, createdAt: date } },
    { seq: seq + 1, id: 'edge', timestamp: date, undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId: '26-103', predecessorId: taskId } });
  await mountSearch(); click(host.querySelector<HTMLButtonElement>(`button[title^="${view}"]`)!);
  expect(list().querySelector('[data-edge-key="26-101->26-103"]')).not.toBeNull();
  click(filter()); type(omni(), 'Gamma');
  expect(list().querySelector('[data-edge-key]')).toBeNull();
  await key(omni(), 'Escape');
  expect(list().querySelector('[data-edge-key="26-101->26-103"]')).not.toBeNull();
});
it.each(['Liste', 'Netzplan', 'Protokoll'])('removes empty date dividers in %s while filtering', async view => {
  await mountSearch(); click(host.querySelector<HTMLButtonElement>(`button[title^="${view}"]`)!);
  expect(list().querySelector('[data-date-divider]')).not.toBeNull();
  click(filter()); type(omni(), 'missing');
  expect(list().querySelector('[data-date-divider]')).toBeNull();
  await key(omni(), 'Escape'); expect(list().querySelector('[data-date-divider]')).not.toBeNull();
});
