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

it.each([false, true])('keeps collapsed details non-interactive with selected task=%s', async selected => {
  await act(async () => root.render(<App />));
  if (selected) click(list().querySelector(`[data-task-drag="${taskId}"]`)!);
  const container = panel(), control = toggle();
  const toolbar = host.querySelector('header')!;
  const detailButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button =>
    [t('Details anzeigen'), t('Details schließen')].includes(button.getAttribute('aria-label') ?? button.title));
  expect(container.querySelector(`button[aria-label="${t('Markdown-Syntax')}"]`)).toBeNull();
  expect(container.querySelector('[data-detail-divider]')).toBeNull();
  expect(control.parentElement).toBe(container);
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
    click(control);
    expect(panel()).toBe(container); expect(toggle()).toBe(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(control.getAttribute('aria-label')).toBe(t('Details schließen'));
    const syntaxHelp = container.querySelector<HTMLButtonElement>(`button[aria-label="${t('Markdown-Syntax')}"]`)!;
    expect(syntaxHelp.parentElement).toBe(container);
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
  };
  assertSizes();
  click(list().querySelector(`[data-task-drag="${secondId}"]`)!);
  expect(container.querySelector('span[title="Beta"]')).not.toBeNull(); assertSizes();
  click(control);
  expect(container.querySelector('[role="separator"]')).toBeNull();
  click(list().querySelector(`[data-task-drag="${taskId}"]`)!); click(control);
  expect(container.querySelector('span[title="Alpha"]')).not.toBeNull(); assertSizes();
  expect(api.AppendBatch).not.toHaveBeenCalled(); expect(api.AppendEvent).not.toHaveBeenCalled();
  expect(api.SetAutostart).not.toHaveBeenCalled();
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
      : list().querySelector(`[data-task-drag="${taskId}"]`)!;
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
  await act(async () => host.querySelector<HTMLButtonElement>('button[title^="' + t('Kompaktansicht') + '"]')!.click());
  const miniTask = host.querySelector(`[data-mini-task-id="${taskId}"]`)!;
  expect(miniTask).not.toBeNull();
  await act(async () => miniTask.querySelector<HTMLButtonElement>('button[title="Alpha"]')!.click());
  expect(api.SetWindowMode).toHaveBeenCalledWith('window');
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
  expect(window.getSelection()!.toString()).toBe('Alpha');
  expect(api.AppendBatch).not.toHaveBeenCalled();
  type(input!, 'Panel draft');
  expect(document.activeElement).toBe(input); expect(input!.textContent).toBe('Panel draft');
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
  await act(async () => { area.querySelector(`[data-task-drag="${taskId}"]`)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(editor(list(), 'title')).toBeNull(); expect(editor(panel(), 'title')).toBeNull();
  expect(api.AppendBatch).not.toHaveBeenCalled();
});

it.each(['list', 'network', 'gantt', 'panel'] as const)(
  'edits the title on one click in %s without replacing its text surface or toggling details', async view => {
    const today = new Date().toISOString();
    history[0].payload = { taskId, title: 'Alpha', configuredStart: today, createdAt: today };
    await mountWithDetails();
    if (view === 'network' || view === 'gantt') click(host.querySelector(`button[aria-keyshortcuts="Control+${view === 'network' ? '2' : '3'}"]`)!);
    const area = view === 'panel' ? panel() : list();
    const title = area.querySelector<HTMLElement>('[data-task-title]')!;
    act(() => { title.focus(); });
    const range = document.createRange(); range.setStart(title.firstChild!, 1); range.setEnd(title.firstChild!, 4);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    click(title);
    expect(editor(area, 'title')).toBe(title);
    expect(window.getSelection()!.toString()).toBe('lph');
    await act(async () => title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(api.SetWindowMode).not.toHaveBeenCalledWith('window');
    type(title, 'Discard'); await key(title, 'Escape');
    expect(title.textContent).toBe('Alpha'); expect(editor(area, 'title')).toBeNull();
    expect(api.AppendBatch).not.toHaveBeenCalled();
    click(title); type(title, 'Renamed'); await key(title, 'Enter');
    expect(api.AppendBatch).toHaveBeenCalledOnce();
    expect(vi.mocked(api.AppendBatch).mock.calls[0][0][0]).toMatchObject({ type: 'TASK_RENAMED', payload: { taskId, title: 'Renamed' } });
    expect(title.textContent).toBe('Renamed'); expect(editor(area, 'title')).toBeNull();
    click(title); type(title, 'Blur renamed');
    await act(async () => title.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(title.textContent).toBe('Blur renamed'); expect(editor(area, 'title')).toBeNull();
    expect(api.AppendBatch).toHaveBeenCalledTimes(2);
  },
);

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
  const editor = (panel().querySelector('.tiptap') as HTMLElement & { editor: import('@tiptap/react').Editor }).editor;
  await act(async () => { editor.commands.insertContent('edited'); });
  expect(undo.disabled).toBe(false);
  await act(async () => undo.click());
  expect(editor.state.doc.textContent).toBe('');
  expect(redo.disabled).toBe(false);
  await act(async () => redo.click());
  expect(editor.state.doc.textContent).toBe('edited');
});


it.each([false, true])('preserves selected details through mini and taskbar=%s', async taskbar => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await mountWithDetails();
  // Compact selection must not inherit the main task.
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  expect(panel().closest('[inert]')).not.toBeNull();
  expect(host.querySelector('[data-mini-task-id][data-task-selected="true"]')).toBeNull();
  if (taskbar) {
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="In die Taskleiste minimieren"]')!.click());
    await act(async () => events.get('window:mode-requested')!('window', false, 'taskbar'));
    expect(api.SetWindowMode).toHaveBeenLastCalledWith('window');
  } else {
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="Fenster"]')!.click());
  }
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(panel().querySelector('span[title="Alpha"]')).not.toBeNull();
  expect(panel().querySelector('[contenteditable="true"]')).not.toBeNull();
});

it('commits the destination view before the host changes geometry and rolls back on failure', async () => {
  await mountWithDetails();
  vi.mocked(api.SetWindowMode).mockImplementationOnce(async () => {
    expect(host.querySelector('main')?.closest('[inert]')).not.toBeNull();
    throw new Error('native transition rejected');
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(panel().querySelector('span[title="Alpha"]')).not.toBeNull();
});

it('keeps main editor history, log drafts and scroll after successful and rejected transitions', async () => {
  await mountWithDetails();
  const originalPanel = panel(), originalList = list();
  originalList.scrollTop = 137;
  const description = panel().querySelector<HTMLElement>('[data-description-editor] [contenteditable="true"]')!;
  const logDraft = panel().querySelector<HTMLTextAreaElement>('[data-task-log] textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(logDraft, 'keep my log');
    logDraft.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  expect(originalPanel.closest('[inert]')).not.toBeNull();
  expect(description.getAttribute('contenteditable')).toBe('false');
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Fenster"]')!.click());
  expect(panel()).toBe(originalPanel);
  expect(list()).toBe(originalList);
  expect(list().scrollTop).toBe(137);
  expect(logDraft.value).toBe('keep my log');
  expect(description.getAttribute('contenteditable')).toBe('true');
  vi.mocked(api.SetWindowMode).mockRejectedValueOnce(new Error('reject'));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  expect(panel()).toBe(originalPanel);
  expect(logDraft.value).toBe('keep my log');
  expect(list().scrollTop).toBe(137);
});

it('commits the requested mini task and details before calling the native restore', async () => {
  await act(async () => root.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  vi.mocked(api.SetWindowMode).mockImplementationOnce(async mode => {
    expect(mode).toBe('window');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('span[title="Alpha"]')).not.toBeNull();
    return mode;
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[data-mini-task-id] button[title="Alpha"]')!.click());
  expect(api.SetWindowMode).toHaveBeenLastCalledWith('window');
});

it('rolls target details back if native restore is rejected', async () => {
  await act(async () => root.render(<App />));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  vi.mocked(api.SetWindowMode).mockRejectedValueOnce(new Error('reject restore'));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-mini-task-id] button[title="Alpha"]')!.click());
  expect(panel().closest('[inert]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Fenster"]')!.click());
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  click(toggle());
  expect(panel().querySelector('span[title="Alpha"]')).toBeNull();
});

it('ignores an older native mode event after a newer revision', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await mountWithDetails();
  await act(async () => events.get('window:mode-changed')!('mini', 10));
  await act(async () => events.get('window:mode-changed')!('window', 11));
  await act(async () => events.get('window:mode-changed')!('mini', 10));
  expect(panel().closest('[inert]')).toBeNull();
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
});

it('rechecks automatic guards after the paint opportunity', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await act(async () => root.render(<App />));
  let release!: () => void;
  vi.mocked(allowWindowPaint).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await act(async () => events.get('window:mode-requested')!('mini', true, 'window'));
  await key(document.body, 'F1');
  await act(async () => release());
  expect(api.SetWindowMode).not.toHaveBeenCalled();
  expect(panel().closest('[inert]')).toBeNull();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});

it('rechecks guards when a queued automatic operation starts', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await act(async () => root.render(<App />));
  let release!: (mode: 'taskbar') => void;
  vi.mocked(api.SetWindowMode).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await act(async () => events.get('window:mode-requested')!('taskbar', false));
  await act(async () => events.get('window:mode-requested')!('mini', true));
  await key(document.body, 'F1');
  await act(async () => release('taskbar'));
  expect(api.SetWindowMode).toHaveBeenCalledTimes(1);
  expect(api.SetWindowMode).toHaveBeenCalledWith('taskbar');
});

it('continues the mode queue on native confirmation when the bridge reply never arrives', async () => {
  const events = new Map<string, (...args: any[]) => void>();
  window.runtime = { EventsOn: (name, callback) => { events.set(name, callback); return () => events.delete(name); } };
  await mountWithDetails();
  vi.mocked(api.SetWindowMode).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Kompaktansicht"]')!.click());
  await act(async () => events.get('window:mode-changed')!('mini', 1));
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="Fenster"]')!.click());
  expect(api.SetWindowMode).toHaveBeenCalledTimes(2);
  expect(api.SetWindowMode).toHaveBeenLastCalledWith('window');
  expect(panel().closest('[inert]')).toBeNull();
});

it('copies configured duration defaults into new tasks and persists progress through the detail editor', async () => {
  vi.mocked(api.GetSettings).mockResolvedValue({ ...settings, defaultDuration: 45, defaultDurationUnit: 'minutes' });
  await mountWithDetails();
  const creation = host.querySelector<HTMLInputElement>('header input')!;
  type(creation, 'Duration fixture');
  await act(async () => { creation.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const duration = () => panel().querySelector<HTMLInputElement>(`input[aria-label="${t('Dauer')}"]`)!;
  const progress = () => panel().querySelector<HTMLInputElement>(`input[aria-label="${t('Fortschritt')}"]`)!;
  expect(duration().value).toBe('45'); expect(progress().value).toBe('');
  expect(panel().querySelector('select')!.value).toBe('minutes');
  const creationCommands = vi.mocked(api.AppendBatch).mock.calls[0][0];
  expect(creationCommands).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'TASK_TIMING_SET', payload: expect.objectContaining({ duration: 45, durationUnit: 'minutes', progress: null }) })]));
  act(() => progress().focus()); type(progress(), '15');
  await act(async () => progress().blur());
  expect(vi.mocked(api.AppendBatch).mock.calls.at(-1)![0]).toEqual([
    expect.objectContaining({ type: 'TASK_TIMING_SET', payload: expect.objectContaining({ duration: 45, durationUnit: 'minutes', progress: 15 }) }),
  ]);
  const id = creationCommands[0].payload.taskId;
  expect(Number(list().querySelector(`[data-task-drag="${id}"] [role="progressbar"]`)!.getAttribute('aria-valuenow'))).toBeCloseTo(100 / 3);
  click(list().querySelector(`[data-task-drag="${taskId}"]`)!);
  expect(duration().value).toBe('1'); expect(progress().value).toBe('');
  click(list().querySelector(`[data-task-drag="${id}"]`)!);
  expect(duration().value).toBe('45'); expect(progress().value).toBe('15');
});

it('saves the default duration through Settings and uses it for subsequent creation', async () => {
  api.SetDefaultDuration = vi.fn(async (defaultDuration, defaultDurationUnit) => ({ ...settings, defaultDuration, defaultDurationUnit: defaultDurationUnit as 'hours' }));
  await act(async () => root.render(<App />));
  click(host.querySelector('button[aria-keyshortcuts="Control+Comma"]')!);
  const defaultField = host.querySelector<HTMLInputElement>(`input[aria-label="${t('Standarddauer')}"]`)!;
  act(() => defaultField.focus()); type(defaultField, '2');
  await act(async () => defaultField.blur());
  expect(api.SetDefaultDuration).toHaveBeenLastCalledWith(2, 'days');
  const unit = defaultField.parentElement!.querySelector('select')!;
  await act(async () => { unit.value = 'hours'; unit.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(api.SetDefaultDuration).toHaveBeenLastCalledWith(2, 'hours');
  click([...host.querySelectorAll('button')].find(button => button.textContent === t('Fertig'))!);
  const creation = host.querySelector<HTMLInputElement>('header input')!;
  type(creation, 'Two hours');
  await act(async () => { creation.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(vi.mocked(api.AppendBatch).mock.calls.at(-1)![0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'TASK_TIMING_SET', payload: expect.objectContaining({ duration: 2, durationUnit: 'hours', progress: null }) }),
  ]));
});
