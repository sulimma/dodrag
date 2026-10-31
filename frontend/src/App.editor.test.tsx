// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AppSettings } from './bridge/eventBridge';
import type { StoredEvent } from './domain/types';
import { projectEvents } from './domain/projector';
import { setLanguage, t } from './i18n';
import { SOURCE_MIME } from './components/editor/targets';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ initial, animate, exit, ...props }: any) => <div {...props} /> },
}));

type NativeAPI = NonNullable<NonNullable<NonNullable<Window['go']>['main']>['App']>;
type NativeCommand = Parameters<NativeAPI['AppendBatch']>[0][number];
const taskId = '26-101';
const date = '2026-10-25T09:00:00.000Z';
const settings: AppSettings = {
  activeDatabasePath: 'editor.db', databaseReady: true, autostart: false,
  knownDatabases: [{ name: 'Editor fixture', path: 'editor.db', exists: true, isDemo: false }],
};
let host: HTMLDivElement, root: Root, api: NativeAPI, history: StoredEvent[];
let pending: { commands: NativeCommand[]; resolve: (events: StoredEvent[]) => void; reject: (error: Error) => void }[];
let nativeDrop: ((x: number, y: number, paths: string[]) => void) | undefined;
let onFileDrop: ReturnType<typeof vi.fn>, onFileDropOff: ReturnType<typeof vi.fn>;
let nativeEvents: Map<string, (...args: unknown[]) => void>;
const geometry = ['getClientRects', 'getBoundingClientRect'] as const;
let originalGeometry: (PropertyDescriptor | undefined)[];
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  // jsdom has no text geometry, which ProseMirror needs when scrolling selection.
  originalGeometry = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key));
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  setLanguage('de');
  pending = []; nativeDrop = undefined; nativeEvents = new Map();
  history = [{
    seq: 1, id: 'created-editor-fixture', timestamp: date, undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: 'Alpha', configuredStart: date, createdAt: date },
  }];
  api = {
    SetEditorReady: vi.fn(async () => {}), FinishClose: vi.fn(async () => {}),
    GetSettings: vi.fn(async () => settings), GetEvents: vi.fn(async () => history),
    AppendBatch: vi.fn((commands: NativeCommand[]) => new Promise<StoredEvent[]>((resolve, reject) => {
      pending.push({ commands, resolve, reject });
    })),
    AppendEvent: vi.fn(async () => history), Undo: vi.fn(async () => history), Redo: vi.fn(async () => history),
    SwitchDatabase: vi.fn(async () => settings), DeleteDatabase: vi.fn(async () => settings),
    CreateDatabase: vi.fn(async () => settings), OpenExistingDatabaseDialog: vi.fn(async () => settings),
    SetAutostart: vi.fn(async () => settings), SelectFolderDialog: vi.fn(async () => ''),
    EnterMiniMode: vi.fn(async () => ''), ExitMiniMode: vi.fn(async () => {}),
    ShowTaskContextMenu: vi.fn(async () => ''), UpdateMiniModeHeight: vi.fn(async () => {}),
    SnapMiniWindowToNearestCorner: vi.fn(async () => ''),
  };
  onFileDrop = vi.fn((callback: typeof nativeDrop) => { nativeDrop = callback; });
  onFileDropOff = vi.fn(() => { nativeDrop = undefined; });
  api.ShowTaskContextMenuAt = api.ShowTaskContextMenu;
  window.go = { main: { App: api } };
  window.runtime = { OnFileDrop: onFileDrop, OnFileDropOff: onFileDropOff,
    EventsOn: vi.fn((name, callback) => { nativeEvents.set(name, callback); return () => { nativeEvents.delete(name); }; }) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  vi.mocked(api.AppendBatch).mockResolvedValue(history);
  await act(async () => { root.unmount(); }); host.remove();
  expect(onFileDropOff).toHaveBeenCalledTimes(onFileDrop.mock.calls.length);
  expect(nativeDrop).toBeUndefined();
  delete window.go; delete window.runtime;
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
  else Reflect.deleteProperty(document, 'elementFromPoint');
  geometry.forEach((key, index) => {
    const descriptor = originalGeometry[index];
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount(description = '') {
  if (description) history.push({ seq: 2, id: 'description-editor-fixture', timestamp: date,
    undone: false, type: 'TASK_DESCRIPTION_SET', payload: { taskId, description } });
  await act(async () => root.render(<App />));
  await act(async () => {
    host.querySelector<HTMLElement>(`main [data-task-drag="${taskId}"]`)!.click();
    host.querySelector<HTMLButtonElement>('[data-detail-toggle]')!.click();
  });
  const dom = host.querySelector<HTMLElement>('.tiptap')!;
  expect(dom).not.toBeNull();
  const editor = (dom as HTMLElement & { editor: Editor }).editor;
  act(() => editor.view.focus());
  expect(document.activeElement).toBe(dom);
  expect(onFileDrop).toHaveBeenCalledWith(expect.any(Function), true);
  return { editor, dom };
}

function insertCharacter(editor: Editor, character: string) {
  // Native text-input rules run before the browser's insertion. jsdom has no
  // editing default action, so use the default transaction only if unhandled.
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to,
    character, () => editor.state.tr.insertText(character, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
}

async function acknowledge() {
  expect(pending).toHaveLength(1);
  const write = pending.shift()!;
  expect(write.commands).toHaveLength(1);
  expect(write.commands[0]).toMatchObject({ type: 'TASK_DESCRIPTION_SET', payload: { taskId } });
  await act(async () => {
    history = [...history, ...write.commands.map((command, index) => ({
      ...command, seq: history.length + index + 1, timestamp: date, undone: false,
    }))];
    write.resolve(history);
  });
  return write.commands[0];
}

const storedDescription = () => projectEvents(history, new Date(date)).tasks[taskId].description;

async function typeLocally(editor: Editor, text: string) {
  for (const character of text) await act(async () => insertCharacter(editor, character));
}
async function key(dom: HTMLElement, value: string, ctrlKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true });
  await act(async () => dom.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
const detailPanel = () => host.querySelector<HTMLElement>('[data-task-detail-panel]')!;
const toggle = () => host.querySelector<HTMLButtonElement>('[data-detail-toggle]')!;
const blurToPanel = async () => { await act(async () => detailPanel().focus()); };

it('keeps Markdown typing and editor undo local, then persists one final result on leaving', async () => {
  const { editor, dom } = await mount();
  await typeLocally(editor, '#');
  expect(dom.querySelector('h1')).toBeNull(); expect(dom.querySelector('p')?.textContent).toBe('#');
  await typeLocally(editor, ' Heading');
  expect(dom.querySelector('h1')?.textContent).toBe('Heading');
  await key(dom, 'Enter'); await typeLocally(editor, 'Body **bold**');
  expect(dom.querySelector('p strong')?.textContent).toBe('bold');
  expect(api.AppendBatch).not.toHaveBeenCalled(); expect(storedDescription()).toBe('');
  await key(dom, 'z', true); await key(dom, 'y', true);
  expect(api.AppendBatch).not.toHaveBeenCalled(); expect(api.Undo).not.toHaveBeenCalled();
  const final = editor.getMarkdown();
  await blurToPanel(); expect(api.AppendBatch).toHaveBeenCalledOnce();
  expect(pending[0].commands[0].payload).toMatchObject({ description: final });
  await acknowledge(); expect(storedDescription()).toBe(final);
  expect(editor.getMarkdown()).toBe(final); expect(api.AppendEvent).not.toHaveBeenCalled();
});

it.each(['collapse', 'task', 'mini', 'escape'] as const)('saves the completed session at the %s boundary', async boundary => {
  history.push({ seq: 2, id: 'second-task', timestamp: date, undone: false, type: 'TASK_CREATED',
    payload: { taskId: '26-102', title: 'Beta', configuredStart: date, createdAt: date } });
  const { editor, dom } = await mount(); await typeLocally(editor, 'Final session result');
  await act(async () => {
    if (boundary === 'collapse') toggle().click();
    else if (boundary === 'task') host.querySelector<HTMLElement>('main [data-task-drag="26-102"]')!.click();
    else if (boundary === 'mini') nativeEvents.get('window:minimized')!();
    else dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  await acknowledge(); expect(storedDescription()).toBe('Final session result');
});

it('does not end the session for toolbar, history controls or native popup focus loss', async () => {
  const { editor, dom } = await mount(); await typeLocally(editor, 'Still editing');
  const toolbar = host.querySelector<HTMLElement>('[role="group"][aria-label="' + t('Textformatierung') + '"]')!;
  await act(async () => toolbar.querySelector<HTMLButtonElement>('button')!.focus());
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => editor.view.focus());
  const undo = detailPanel().querySelector<HTMLButtonElement>('[data-editor-history] button')!;
  await act(async () => undo.focus()); expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => editor.view.focus());
  await act(async () => dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => dom.blur());
  expect(api.AppendBatch).not.toHaveBeenCalled();
  await act(async () => editor.view.focus()); await blurToPanel(); await acknowledge();
  expect(storedDescription()).toBe('Still editing');
});

it('keeps a failed final save when details are closed and reopened', async () => {
  const { editor, dom } = await mount(); await typeLocally(editor, 'Keep important note');
  await blurToPanel();
  await act(async () => pending.shift()!.reject(new Error('Disk write rejected')));
  expect(dom.textContent).toContain('Keep important note'); expect(storedDescription()).toBe('');
  await act(async () => toggle().click());
  await act(async () => toggle().click());
  expect(host.querySelector('.tiptap')!.textContent).toContain('Keep important note');
  await acknowledge(); expect(storedDescription()).toBe('Keep important note');
});

it('keeps newer typing and the caret while the preceding session save completes', async () => {
  const { editor } = await mount(); await typeLocally(editor, '# First'); await blurToPanel();
  await act(async () => editor.view.focus()); await typeLocally(editor, ' newer');
  const liveDocument = editor.state.doc, caret = editor.state.selection.from;
  await acknowledge();
  expect(editor.state.doc).toBe(liveDocument); expect(editor.state.selection.from).toBe(caret);
  expect(editor.getMarkdown()).toBe('# First newer'); expect(storedDescription()).toBe('# First');
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  await blurToPanel(); await acknowledge(); expect(storedDescription()).toBe('# First newer');
});

it('keeps native file drop and local undo in the same unsaved editing session', async () => {
  const prefix = 'Existing prefix'; const { editor, dom } = await mount(prefix);
  await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await typeLocally(editor, ' typed ');
  const beforeDrop = editor.state.doc.textContent;
  const panel = detailPanel(), log = host.querySelector<HTMLElement>('[data-task-log]')!.parentElement!;
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 480, 800));
  vi.spyOn(log, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 480, 200));
  const coords = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: editor.state.selection.from, inside: 0 });
  const path = 'C:\\Files\\dropped document.txt';
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => dom });
  await act(async () => {
    nativeDrop!(120, 250, [path]);
    expect(document.activeElement).toBe(dom);
  });
  expect(coords).toHaveBeenCalledWith({ left: 120, top: 250 });
  const withDrop = editor.state.doc.textContent; expect(withDrop).toBe(`${beforeDrop}"${path}"`);
  await typeLocally(editor, ' continued');
  await key(dom, 'z', true); expect(editor.state.doc.textContent).toBe(withDrop);
  await key(dom, 'z', true); expect(editor.state.doc.textContent).toBe(beforeDrop);
  expect(api.AppendBatch).not.toHaveBeenCalled(); expect(api.Undo).not.toHaveBeenCalled();
  await blurToPanel(); await acknowledge(); expect(storedDescription()).toBe(editor.getMarkdown());
});

it('incorporates sources locally before saving so further typing cannot overwrite them', async () => {
  const { editor } = await mount(); await typeLocally(editor, 'Local draft');
  const source = { kind: 'url', value: 'https://example.com/source' };
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: [SOURCE_MIME], getData: () => JSON.stringify(source) } });
  await act(async () => host.querySelector('[data-source-task-id="' + taskId + '"]')!.dispatchEvent(event));
  expect(pending[0].commands[0].payload).toMatchObject({ description: 'Local draft\n\n<https://example.com/source>' });
  expect(editor.getMarkdown()).toContain('https://example.com/source');
  await act(async () => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  await typeLocally(editor, ' continued');
  await acknowledge(); expect(editor.getMarkdown()).toContain('https://example.com/source');
  await blurToPanel(); await acknowledge();
  expect(storedDescription()).toBe(editor.getMarkdown()); expect(storedDescription()).toContain('continued');
});

it('finishes a local session before global undo', async () => {
  const { editor } = await mount(); await typeLocally(editor, 'Before global undo');
  const control = host.querySelector<HTMLButtonElement>('header button[title^="' + t('Rückgängig') + '"]')!;
  await act(async () => control.click());
  expect(api.Undo).not.toHaveBeenCalled(); await acknowledge(); expect(api.Undo).toHaveBeenCalledOnce();
});

it('waits for final persistence before acknowledging native close and retries failed closes', async () => {
  const { editor } = await mount(); await typeLocally(editor, 'Before close');
  expect(api.SetEditorReady).toHaveBeenCalledWith(true);
  await act(async () => nativeEvents.get('app:before-close')!());
  expect(api.FinishClose).not.toHaveBeenCalled(); expect(document.body.inert).toBe(true);
  await act(async () => pending.shift()!.reject(new Error('Disk unavailable')));
  expect(api.FinishClose).toHaveBeenLastCalledWith(false); expect(storedDescription()).toBe('');
  expect(document.body.inert).not.toBe(true);
  await act(async () => nativeEvents.get('app:before-close')!());
  await acknowledge(); expect(api.FinishClose).toHaveBeenLastCalledWith(true);
  expect(storedDescription()).toBe('Before close');
});
