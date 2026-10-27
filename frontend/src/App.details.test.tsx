// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AppSettings } from './bridge/eventBridge';
import type { StoredEvent } from './domain/types';
import { setLanguage, t } from './i18n';

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
    EnterMiniMode: vi.fn(async () => ''), ExitMiniMode: vi.fn(async () => {}),
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

const panel = () => host.querySelector<HTMLElement>(`aside[aria-label="${t('Task-Details')}"]`)!;
const list = () => host.querySelector<HTMLElement>('main')!;
const toggle = () => panel().querySelector<HTMLButtonElement>(':scope > button[data-detail-toggle]')!;
const click = (target: Element) => act(() => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const cssWidth = (value: string) => {
  const control = document.createElement('div'); control.style.width = value; return control.style.width;
};
const key = async (target: Element, value: string) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  })); });
};
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const label = (kind: 'title' | 'date') => t(kind === 'title' ? 'Titel {id}' : 'Startdatum {id}', { id: taskId });
const editor = (area: Element, kind: 'title' | 'date') => area.querySelector<HTMLInputElement>(`input[aria-label="${label(kind)}"]`);

async function mountWithDetails() {
  await act(async () => root.render(<App />));
  const collapsed = panel();
  expect(collapsed).not.toBeNull();
  expect(collapsed.querySelector('header')).toBeNull();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  click(list().querySelector(`[data-task-drag="${taskId}"]`)!);
  click(toggle());
  expect(panel()).toBe(collapsed);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(panel().querySelector('header')).not.toBeNull();
  expect(panel().querySelector('[contenteditable="true"]')).not.toBeNull();
  expect(list().querySelector('span[title="Alpha"]')).not.toBeNull();
}

it.each([false, true])('keeps only the toggle in the narrow collapsed strip with selected task=%s', async selected => {
  await act(async () => root.render(<App />));
  if (selected) click(list().querySelector(`[data-task-drag="${taskId}"]`)!);
  const container = panel(), control = toggle();
  const toolbar = host.querySelector('header')!;
  const detailButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button =>
    [t('Details anzeigen'), t('Details schließen')].includes(button.getAttribute('aria-label') ?? button.title));
  expect(container.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
  expect(container.querySelector(`button[aria-label="${t('Markdown-Syntax')}"]`)).toBeNull();
  expect(container.classList.contains('transition-[width]')).toBe(true);
  expect(container.classList.contains('duration-300')).toBe(true);
  expect(container.querySelector('[data-detail-divider]')).toBeNull();
  expect(control.parentElement).toBe(container);
  expect(control.classList.contains('top-3')).toBe(true);
  expect(control.classList.contains('right-0')).toBe(true);
  expect(control.classList.contains('w-7')).toBe(true);
  expect(control.querySelector('svg')!.classList.contains('w-5')).toBe(true);
  expect(toolbar.contains(control)).toBe(false);
  expect(detailButtons()).toEqual([control]);
  const placeholder = t('Task auswählen, um Details, Beschreibung und Log anzuzeigen');
  for (let cycle = 0; cycle < 2; cycle++) {
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(control.getAttribute('aria-label')).toBe(t('Details anzeigen'));
    expect(container.querySelector('header,[contenteditable="true"],[data-task-log]')).toBeNull();
    expect(container.textContent).not.toContain(placeholder);
    expect(container.hasAttribute('data-task-drag')).toBe(false);
    expect(container.hasAttribute('data-task-drop-target')).toBe(false);
    expect(container.style.getPropertyValue('--wails-drop-target')).toBe('none');
    click(control);
    expect(panel()).toBe(container); expect(toggle()).toBe(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(control.getAttribute('aria-label')).toBe(t('Details schließen'));
    const syntaxHelp = container.querySelector<HTMLButtonElement>(`button[aria-label="${t('Markdown-Syntax')}"]`)!;
    expect(syntaxHelp.parentElement).toBe(container);
    expect(syntaxHelp.classList.contains('right-7')).toBe(true);
    expect(container.style.width).toBe('var(--detail-width)');
    expect(container.style.getPropertyValue('--detail-width')).toBe('min(560px, max(200px, calc(100vw - 300px)))');
    const content = container.querySelector('header')!.parentElement!;
    expect(content.style.width).toBe('var(--detail-width)');
    expect(content.classList.contains('left-0')).toBe(true);
    expect(content.classList.contains('right-8')).toBe(false);
    expect(container.querySelector('header')).not.toBeNull();
    if (selected) {
      expect(container.querySelector('span[title="Alpha"]')).not.toBeNull();
      expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
      expect(container.getAttribute('data-task-drop-target')).toBe(`detail-task:${taskId}`);
    } else {
      expect(container.textContent).toContain(placeholder);
      expect(container.querySelector('[contenteditable="true"]')).toBeNull();
      expect(container.hasAttribute('data-task-drop-target')).toBe(false);
    }
    expect(detailButtons()).toEqual([control]);
    click(control);
    expect(panel()).toBe(container); expect(toggle()).toBe(control);
    expect(container.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
    expect(container.querySelector(`button[aria-label="${t('Markdown-Syntax')}"]`)).toBeNull();
  }
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('retains independent detail and log sizes across task selection and collapse without saving settings', async () => {
  const secondId = '26-102';
  history.push({ seq: 2, id: 'created-second-fixture', timestamp: date, undone: false,
    type: 'TASK_CREATED', payload: { taskId: secondId, title: 'Beta', configuredStart: date, createdAt: date } });
  await mountWithDetails();
  const container = panel(), control = toggle();
  const separator = (orientation: 'vertical' | 'horizontal') => panel().querySelector<HTMLElement>(
    `[role="separator"][aria-orientation="${orientation}"]`,
  )!;
  await key(separator('vertical'), 'ArrowRight');
  expect(separator('vertical').getAttribute('aria-valuenow')).toBe('570');
  expect(separator('horizontal').getAttribute('aria-valuenow')).toBe('224');
  await key(separator('horizontal'), 'ArrowUp');
  expect(separator('horizontal').getAttribute('aria-valuenow')).toBe('234');
  const assertSizes = () => {
    expect(panel()).toBe(container); expect(toggle()).toBe(control);
    expect(separator('vertical').getAttribute('aria-valuenow')).toBe('570');
    expect(separator('horizontal').getAttribute('aria-valuenow')).toBe('234');
    expect(container.style.getPropertyValue('--detail-width')).toBe('min(570px, max(200px, calc(100vw - 300px)))');
    const logArea = container.querySelector<HTMLElement>('[data-task-log]')!.parentElement!;
    const expected = document.createElement('div'); expected.style.height = 'min(234px, max(100px, calc(100% - 290px)))';
    expect(logArea.style.height).toBe(expected.style.height);
    expect(container.querySelector<HTMLElement>('[data-task-log]')!.classList.contains('h-full')).toBe(true);
  };
  assertSizes();
  click(list().querySelector(`[data-task-drag="${secondId}"]`)!);
  expect(container.querySelector('span[title="Beta"]')).not.toBeNull(); assertSizes();
  click(control);
  expect(container.querySelector('[role="separator"]')).toBeNull();
  expect(container.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
  click(list().querySelector(`[data-task-drag="${taskId}"]`)!); click(control);
  expect(container.querySelector('span[title="Alpha"]')).not.toBeNull(); assertSizes();
  expect(api.AppendBatch).not.toHaveBeenCalled(); expect(api.AppendEvent).not.toHaveBeenCalled();
  expect(api.SetAutostart).not.toHaveBeenCalled();
});

it('uses the full list width without max-width or auto-centering in either panel state', async () => {
  await act(async () => root.render(<App />));
  const listRoot = list().firstElementChild as HTMLElement;
  expect(listRoot.querySelector(`[data-task-drag="${taskId}"]`)).not.toBeNull();
  for (let state = 0; state < 3; state++) {
    expect(list().firstElementChild).toBe(listRoot);
    expect(listRoot.classList.contains('w-full')).toBe(true);
    expect([...listRoot.classList].some(name => name.startsWith('max-w-'))).toBe(false);
    expect(listRoot.classList.contains('mx-auto')).toBe(false);
    click(toggle());
  }
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it.each(['list', 'network', 'gantt', 'gantt-bar', 'completed'] as const)(
  'toggles details after full double-click sequences in %s without renaming', async view => {
    if (view === 'completed') history.push({ seq: 2, id: 'closed-fixture', timestamp: date, undone: false,
      type: 'TASK_COMPLETED', payload: { taskId, completedAt: date } });
    await act(async () => root.render(<App />));
    if (view === 'network' || view.startsWith('gantt')) {
      click(host.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="Control+${view === 'network' ? '2' : '3'}"]`)!);
    }
    const target = view === 'completed' ? host.querySelector(`[data-completed-task="${taskId}"] span[data-task-selectable-text]`)!
      : view === 'gantt-bar' ? host.querySelector(`[data-gantt-node="${taskId}"]`)!
      : list().querySelector('span[title="Alpha"]')!;
    expect(target).not.toBeNull();
    click(target); click(target);
    await act(async () => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('span[title="Alpha"]')).not.toBeNull();
    expect(editor(list(), 'title')).toBeNull(); expect(editor(panel(), 'title')).toBeNull();
    expect(panel().textContent).toContain(t('Task erstellt'));
    if (view === 'completed') expect(panel().textContent).toContain(t('Task geschlossen'));
    click(target); click(target);
    await act(async () => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(editor(list(), 'title')).toBeNull();
    expect(api.AppendBatch).not.toHaveBeenCalled();
  },
);

it('opens details when restoring a task from the mini view', async () => {
  const today = new Date().toISOString();
  history = [{ ...history[0], type: 'TASK_CREATED', payload: { taskId, title: 'Alpha', configuredStart: today, createdAt: today } }];
  await act(async () => root.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title^="' + t('Minimieren (Kompaktansicht in Bildschirmecke)') + '"]')!.click());
  const miniTask = host.querySelector(`[data-mini-task-id="${taskId}"]`)!;
  expect(miniTask).not.toBeNull();
  await act(async () => miniTask.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(api.ExitMiniMode).toHaveBeenCalledOnce();
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(panel().querySelector('span[title="Alpha"]')).not.toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it('persists inline log edits through the native batch bridge without changing their timestamp', async () => {
  history.push({ seq: 2, id: 'note-fixture', timestamp: date, undone: false, type: 'TASK_LOG_ADDED',
    payload: { taskId, entryId: 'note', text: 'Original note', createdAt: date } });
  await mountWithDetails();
  const article = panel().querySelector('[data-log-entry="note"]')!;
  click(article.querySelector('span')!);
  const input = article.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Edited note');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toEqual([
    expect.objectContaining({ type: 'TASK_LOG_UPDATED', payload: { taskId, entryId: 'note', text: 'Edited note' } }),
  ]);
  expect(article.querySelector('textarea')).toBeNull();
  expect(article.textContent).toContain('Edited note');
  expect(article.querySelector('time')!.dateTime).toBe(date);
});

it.each(['F2', 'Enter'])('keeps %s title editing in the focused detail panel until explicit commit', async shortcut => {
  await mountWithDetails();
  act(() => panel().focus());
  expect(document.activeElement).toBe(panel());
  await key(panel(), shortcut);
  const input = editor(panel(), 'title');
  expect(input, 'Panel editor must survive the list focus effect and its blur commit').not.toBeNull();
  expect(editor(list(), 'title'), 'The other view must not open a competing input').toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input!.selectionStart).toBe(0); expect(input!.selectionEnd).toBe('Alpha'.length);
  expect(api.AppendBatch).not.toHaveBeenCalled();
  type(input!, 'Panel draft');
  expect(document.activeElement).toBe(input); expect(input!.value).toBe('Panel draft');
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await key(input!, 'Enter');
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0]).toEqual([
    expect.objectContaining({ type: 'TASK_RENAMED', payload: { taskId, title: 'Panel draft' } }),
  ]);
  expect(editor(panel(), 'title')).toBeNull();
  expect(panel().querySelector('span[title="Panel draft"]')).not.toBeNull();
  expect(list().querySelector('span[title="Panel draft"]')).not.toBeNull();
});

it.each(['panel', 'list'] as const)('closes details on task double-click from its %s origin without starting a title editor', async origin => {
  await mountWithDetails(); const area = origin === 'panel' ? panel() : list();
  await act(async () => { area.querySelector('span[title="Alpha"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(editor(list(), 'title')).toBeNull(); expect(editor(panel(), 'title')).toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it.each(['panel', 'list'] as const)('keeps date editing and focus in its %s origin without premature persistence', async origin => {
  await mountWithDetails(); const area = origin === 'panel' ? panel() : list();
  await act(async () => { click(area.querySelector(`button[aria-label="${t('Startdatum {id} bearbeiten', { id: taskId })}"]`)!); });
  const input = editor(area, 'date');
  expect(input, 'Date input must survive the competing date focus effect').not.toBeNull();
  expect(editor(origin === 'panel' ? list() : panel(), 'date')).toBeNull();
  expect(document.activeElement).toBe(input); expect(api.AppendBatch).not.toHaveBeenCalled();
  type(input!, '2026-10-28');
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await key(input!, 'Enter');
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({
    type: 'TASK_START_DATE_SET', payload: { taskId,
      configuredStart: new Date(2026, 9, 28, 9).toISOString() },
  });
  expect(editor(area, 'date')).toBeNull();
});

it('puts live editor undo and redo beside the dates, not among the menus', async () => {
  await mountWithDetails();
  const dates = panel().querySelector('[data-detail-dates]')!;
  const undo = dates.querySelector<HTMLButtonElement>(`button[aria-label="${t('Rückgängig')}"]`)!;
  const redo = dates.querySelector<HTMLButtonElement>(`button[aria-label="${t('Wiederholen')}"]`)!;
  expect(undo.disabled).toBe(true); expect(redo.disabled).toBe(true);
  const menus = panel().querySelector(`[role="group"][aria-label="${t('Textformatierung')}"]`)!;
  expect(menus.querySelector('[data-editor-history]')).toBeNull();
  expect(menus.querySelector('button span')!.classList.contains('text-[11px]')).toBe(true);
  const editor = (panel().querySelector('.tiptap') as HTMLElement & { editor: import('@tiptap/react').Editor }).editor;
  await act(async () => { editor.commands.insertContent('edited'); });
  expect(undo.disabled).toBe(false);
  await act(async () => undo.click());
  expect(editor.state.doc.textContent).toBe('');
  expect(redo.disabled).toBe(false);
  await act(async () => redo.click());
  expect(editor.state.doc.textContent).toBe('edited');
});
