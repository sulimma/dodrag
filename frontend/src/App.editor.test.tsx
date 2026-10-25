// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AppSettings } from './bridge/eventBridge';
import type { StoredEvent } from './domain/types';
import { projectEvents } from './domain/projector';
import { setLanguage } from './i18n';

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
let pending: { commands: NativeCommand[]; resolve: (events: StoredEvent[]) => void }[];
let nativeDrop: ((x: number, y: number, paths: string[]) => void) | undefined;
let onFileDrop: ReturnType<typeof vi.fn>, onFileDropOff: ReturnType<typeof vi.fn>;
const geometry = ['getClientRects', 'getBoundingClientRect'] as const;
let originalGeometry: (PropertyDescriptor | undefined)[];

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
  pending = []; nativeDrop = undefined;
  history = [{
    seq: 1, id: 'created-editor-fixture', timestamp: date, undone: false,
    type: 'TASK_CREATED', payload: { taskId, title: 'Alpha', configuredStart: date, createdAt: date },
  }];
  api = {
    GetSettings: vi.fn(async () => settings), GetEvents: vi.fn(async () => history),
    AppendBatch: vi.fn((commands: NativeCommand[]) => new Promise<StoredEvent[]>(resolve => {
      pending.push({ commands, resolve });
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
  window.go = { main: { App: api } };
  window.runtime = { OnFileDrop: onFileDrop, OnFileDropOff: onFileDropOff,
    EventsOn: vi.fn(() => () => {}) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount()); host.remove();
  expect(onFileDropOff).toHaveBeenCalledTimes(onFileDrop.mock.calls.length);
  expect(nativeDrop).toBeUndefined();
  delete window.go; delete window.runtime;
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

async function typeAndSave(editor: Editor, text: string, check?: () => void) {
  for (const character of text) {
    await act(async () => insertCharacter(editor, character));
    const expected = editor.getMarkdown();
    check?.();
    await acknowledge();
    // Input rules may emit insertion and conversion separately in TipTap 3.
    while (pending.length) await acknowledge();
    expect(storedDescription()).toBe(expected);
    expect(editor.getMarkdown()).toBe(expected);
    expect(host.querySelector('.tiptap')).toBe(editor.view.dom);
    check?.();
  }
}

async function key(dom: HTMLElement, value: string, ctrlKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true });
  await act(async () => dom.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

it('treats # alone as literal text, then retains the # space heading after every native save acknowledgement', async () => {
  const { editor, dom } = await mount();
  await typeAndSave(editor, '#');
  expect(dom.querySelector('h1')).toBeNull();
  expect(dom.querySelector('p')?.textContent).toBe('#');
  // Standard Markdown requires the trailing space; do not reinterpret bare #.
  await typeAndSave(editor, ' ', () => expect(dom.querySelector('h1')).not.toBeNull());
  const heading = editor.state.doc.firstChild;
  await typeAndSave(editor, 'Heading', () => {
    expect(dom.querySelector('h1')).not.toBeNull();
    expect(editor.state.doc.firstChild?.type).toBe(heading?.type);
  });
  expect(storedDescription()).toBe('# Heading');
  await key(dom, 'Enter'); await acknowledge();
  await typeAndSave(editor, 'Body **bold**', () => expect(dom.querySelector('h1')?.textContent).toBe('Heading'));
  expect(dom.querySelector('p strong')?.textContent).toBe('bold');
  expect(storedDescription()).toBe('# Heading\n\nBody **bold**');
  expect(new Set(vi.mocked(api.AppendBatch).mock.calls.map(([commands]) => commands[0].groupId)).size).toBe(1);
  expect(api.AppendEvent).not.toHaveBeenCalled();
});

it('does not let queued older native snapshots replace a newer live heading or its caret', async () => {
  const { editor, dom } = await mount();
  const text = '# Queued';
  for (const character of text) await act(async () => insertCharacter(editor, character));
  expect(pending).toHaveLength(1);
  expect(api.AppendBatch).toHaveBeenCalledOnce();
  const liveDocument = editor.state.doc;
  const caret = editor.state.selection.from;
  let writes = 0;
  while (pending.length) {
    await acknowledge();
    writes++;
    expect(editor.state.doc).toBe(liveDocument);
    expect(editor.state.selection.from).toBe(caret);
    expect(dom.querySelector('h1')?.textContent).toBe('Queued');
  }
  expect(writes).toBeGreaterThanOrEqual(text.length);
  expect(pending).toHaveLength(0);
  expect(storedDescription()).toBe('# Queued');
  await typeAndSave(editor, '!', () => expect(dom.querySelector('h1')).not.toBeNull());
  expect(storedDescription()).toBe('# Queued!');
});

it('focuses the native drop immediately, appends further typing at the inserted end and undoes without deleting existing text', async () => {
  const prefix = 'Existing prefix';
  const { editor, dom } = await mount(prefix);
  await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await typeAndSave(editor, ' typed ');
  const beforeDrop = editor.state.doc.textContent;
  const beforeMarkdown = storedDescription();
  const panel = host.querySelector<HTMLElement>('[data-task-detail-panel]')!;
  const log = host.querySelector<HTMLElement>('[data-task-log]')!.parentElement!;
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 480, 800));
  vi.spyOn(log, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 480, 200));
  const insertion = editor.state.selection.from;
  const coords = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: insertion, inside: 0 });
  const path = 'C:\\Files\\dropped document.txt';
  await act(async () => {
    panel.focus(); // Explorer/native window activation does not focus contenteditable.
    nativeDrop!(120, 250, [path]);
    expect(document.activeElement, 'Drop must focus synchronously, not on a later animation frame').toBe(dom);
    expect(editor.state.doc.textContent).toBe(`${beforeDrop}"${path}"`);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });
  expect(coords).toHaveBeenCalledWith({ left: 120, top: 250 });
  const dropCommand = await acknowledge();
  expect(storedDescription()).toBe(editor.getMarkdown());
  const withDrop = editor.state.doc.textContent;
  await typeAndSave(editor, ' continued', () => expect(document.activeElement).toBe(dom));
  expect(editor.state.doc.textContent).toBe(`${withDrop} continued`);
  const typingCommand = vi.mocked(api.AppendBatch).mock.lastCall![0][0];
  expect(typingCommand.groupId).not.toBe(dropCommand.groupId);
  await key(dom, 'z', true); await acknowledge();
  expect(editor.state.doc.textContent).toBe(withDrop);
  await key(dom, 'z', true); await acknowledge();
  expect(editor.state.doc.textContent).toBe(beforeDrop);
  expect(storedDescription()).toBe(beforeMarkdown);
  expect(editor.state.doc.textContent.startsWith(prefix)).toBe(true);
  expect(api.Undo, 'Contenteditable Ctrl+Z must not reach the global task undo').not.toHaveBeenCalled();
  expect(api.Redo).not.toHaveBeenCalled();
});
