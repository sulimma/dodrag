// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskLogSection, type TaskLogSectionHandle, type TaskLogSectionProps } from './TaskLogSection';
import type { EditorContextMenu } from './editor/types';
import { t } from '../i18n';

const native = vi.hoisted(() => ({ explorer: vi.fn(), vscode: vi.fn(), url: vi.fn() }));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: {
  openPathInExplorer: native.explorer, openPathInVSCode: native.vscode, openExternalURL: native.url,
  getPathKind: () => new Promise<'file'>(() => {}),
} }));

let host: HTMLDivElement, root: Root, props: TaskLogSectionProps;
let context: EditorContextMenu;
let frames: FrameRequestCallback[];
let clipboardDescriptor: PropertyDescriptor | undefined;
const writeText = vi.fn(), readText = vi.fn(), outerMenu = vi.fn();
const ref = createRef<TaskLogSectionHandle>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } });
  writeText.mockResolvedValue(undefined); readText.mockResolvedValue('inserted');
  native.explorer.mockResolvedValue(undefined); native.vscode.mockResolvedValue(undefined); native.url.mockResolvedValue(undefined);
  props = {
    entries: [{ id: 'note', text: 'Plain note text', createdAt: '2026-10-25T12:00:00Z' },
      { id: 'targets', text: '"C:\\folder\\file.txt" https://example.com ![preview](C:\\image.png)', createdAt: '2026-10-25T12:01:00Z' }],
    taskId: 'task', onAdd: vi.fn(), onRemove: vi.fn(), onError: vi.fn(),
    onContextMenu: vi.fn((_event: React.MouseEvent, menu: EditorContextMenu) => { context = menu; }),
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); window.getSelection()?.removeAllRanges();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function render() {
  act(() => root.render(<div onContextMenu={outerMenu}><TaskLogSection ref={ref} {...props} /></div>));
}
function field() { return host.querySelector<HTMLTextAreaElement>('textarea')!; }
function change(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function menu(element: Element) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => { element.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(outerMenu).not.toHaveBeenCalled();
  return context;
}
async function execute(action: string, active = context) { await act(async () => { await active.execute(action); }); }
function flushFrames() { act(() => { frames.splice(0).forEach(callback => callback(0)); }); }

it('offers translated input-only actions with cut/copy disabled without a selection', async () => {
  change('first second'); field().setSelectionRange(3, 3);
  expect(menu(field()).items).toEqual([
    { id: 'cut', label: t('Ausschneiden'), disabled: true },
    { id: 'copy', label: t('Kopieren'), disabled: true },
    { id: 'paste', label: t('Einfügen'), disabled: false },
  ]);
  await execute('cut'); await execute('copy'); await execute('complete');
  expect(writeText).not.toHaveBeenCalled(); expect(field().value).toBe('first second');
  field().setSelectionRange(6, 12);
  expect(menu(field()).items.map(item => item.disabled)).toEqual([false, false, false]);
  await execute('copy'); expect(writeText).toHaveBeenCalledWith('second');
  expect(field().value).toBe('first second');
});

it('cuts selected input only after clipboard success and restores actual focus/caret', async () => {
  change('first second'); field().setSelectionRange(6, 12); menu(field());
  await execute('cut'); flushFrames();
  expect(writeText).toHaveBeenCalledWith('second'); expect(field().value).toBe('first ');
  expect(document.activeElement).toBe(field()); expect(field().selectionStart).toBe(6);
  expect(props.onAdd).not.toHaveBeenCalled();
});

it('pastes clipboard text over the input selection without submitting', async () => {
  change('first second'); field().setSelectionRange(6, 12); menu(field());
  await execute('paste'); flushFrames();
  expect(readText).toHaveBeenCalledOnce(); expect(field().value).toBe('first inserted');
  expect(document.activeElement).toBe(field()); expect(field().selectionStart).toBe(14);
  expect(props.onAdd).not.toHaveBeenCalled();
});

it('preserves the draft and reports clipboard write/read errors', async () => {
  change('keep this'); field().setSelectionRange(0, 4); menu(field());
  const failure = new Error('Clipboard denied'); writeText.mockRejectedValueOnce(failure);
  await execute('cut'); expect(field().value).toBe('keep this'); expect(props.onError).toHaveBeenCalledWith(failure);
  readText.mockRejectedValueOnce(failure); await execute('paste');
  expect(field().value).toBe('keep this'); expect(props.onError).toHaveBeenCalledTimes(2);
});

it('does not overwrite a changed draft while asynchronous cut or paste is pending', async () => {
  for (const action of ['cut', 'paste']) {
    change('original draft'); field().setSelectionRange(0, 8); const active = menu(field());
    let resolve!: (text: string) => void;
    (action === 'cut' ? writeText : readText).mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
    let operation!: Promise<void>;
    act(() => { operation = active.execute(action); });
    change('new draft');
    await act(async () => { resolve('clipboard'); await operation; });
    expect(field().value).toBe('new draft'); expect(frames).toHaveLength(0);
  }
});

it('ignores stale input menus and pending clipboard changes after switching tasks', async () => {
  change('old draft'); field().setSelectionRange(0, 3); const active = menu(field());
  let resolve!: () => void;
  writeText.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
  let operation!: Promise<void>; act(() => { operation = active.execute('cut'); });
  props = { ...props, taskId: 'other' }; render(); change('other draft');
  await act(async () => { resolve(); await operation; });
  await execute('paste', active);
  expect(field().value).toBe('other draft'); expect(readText).not.toHaveBeenCalled();
});

it('offers copy and delete for ordinary log entries and copies entry text without its timestamp', async () => {
  const article = host.querySelector('[data-log-entry="note"]')!;
  expect(menu(article.querySelector('span')!).items).toEqual([
    { id: 'copy', label: t('Kopieren'), disabled: false },
    { id: 'delete', label: t('löschen'), disabled: false },
  ]);
  await execute('copy'); expect(writeText).toHaveBeenLastCalledWith('Plain note text');
  await execute('cut'); await execute('paste'); await execute('complete');
  expect(writeText).toHaveBeenCalledOnce(); expect(readText).not.toHaveBeenCalled();
  const range = document.createRange(); range.setStart(article.querySelector('span')!.firstChild!, 6);
  range.setEnd(article.querySelector('span')!.firstChild!, 10); window.getSelection()!.addRange(range);
  menu(article.querySelector('span')!); await execute('copy'); expect(writeText).toHaveBeenLastCalledWith('note');
  const failure = new Error('Copy failed'); writeText.mockRejectedValueOnce(failure);
  await execute('copy'); expect(props.onError).toHaveBeenCalledWith(failure);
});

it('keeps target actions alongside entry deletion, ignores unsupported actions and reports opening errors', async () => {
  const path = host.querySelector('[data-target-kind="path"]')!;
  expect(menu(path).items.map(item => item.id)).toEqual(['path:explorer', 'path:vscode', 'delete']);
  await execute('copy'); await execute('complete'); expect(native.explorer).not.toHaveBeenCalled();
  await execute('path:explorer'); await execute('path:vscode');
  expect(native.explorer).toHaveBeenCalledWith('C:\\folder\\file.txt'); expect(native.vscode).toHaveBeenCalledWith('C:\\folder\\file.txt');
  expect(menu(host.querySelector('img')!).items.map(item => item.id)).toEqual(['path:explorer', 'path:vscode', 'delete']);
  await execute('path:explorer'); expect(native.explorer).toHaveBeenLastCalledWith('C:\\image.png');
  const url = host.querySelector('[data-target-kind="url"]')!;
  expect(menu(url).items).toEqual([
    { id: 'url:open', label: t('Im Browser öffnen'), disabled: false },
    { id: 'delete', label: t('löschen'), disabled: false },
  ]);
  await execute('path:vscode'); expect(native.url).not.toHaveBeenCalled();
  const failure = new Error('Open failed'); native.url.mockRejectedValueOnce(failure);
  await execute('url:open'); expect(native.url).toHaveBeenCalledWith('https://example.com');
  expect(props.onError).toHaveBeenCalledWith(failure); expect(writeText).not.toHaveBeenCalled();
});

it('deletes the clicked ordinary, path, image or URL entry without opening targets or touching the draft', async () => {
  change('keep draft');
  for (const [selector, entryId] of [
    ['[data-log-entry="note"] time', 'note'], ['[data-target-kind="path"]', 'targets'],
    ['img', 'targets'], ['[data-target-kind="url"]', 'targets'],
  ]) {
    menu(host.querySelector(selector)!); await execute('delete');
    expect(props.onRemove).toHaveBeenLastCalledWith(entryId);
  }
  expect(props.onRemove).toHaveBeenCalledTimes(4);
  expect(native.explorer).not.toHaveBeenCalled(); expect(native.vscode).not.toHaveBeenCalled(); expect(native.url).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled(); expect(readText).not.toHaveBeenCalled(); expect(props.onAdd).not.toHaveBeenCalled();
  expect(field().value).toBe('keep draft');
  menu(field()); await execute('delete'); menu(host.querySelector('h3')!); await execute('delete');
  expect(props.onRemove).toHaveBeenCalledTimes(4);
});

it('reports deletion errors and ignores stale entry menus after deletion or switching tasks', async () => {
  const failure = new Error('Removal failed'); vi.mocked(props.onRemove).mockRejectedValueOnce(failure);
  const active = menu(host.querySelector('[data-log-entry="note"]')!);
  await execute('delete'); expect(props.onError).toHaveBeenCalledWith(failure);
  props = { ...props, entries: props.entries.filter(entry => entry.id !== 'note') }; render();
  await execute('delete', active); expect(props.onRemove).toHaveBeenCalledOnce();
  const targetMenu = menu(host.querySelector('[data-target-kind="url"]')!);
  props = { ...props, taskId: 'other' }; render();
  await execute('delete', targetMenu); expect(props.onRemove).toHaveBeenCalledOnce();
});

it('does not open targets when clicking ordinary entries, input, heading or unsupported log space', async () => {
  for (const element of [host.querySelector('[data-log-entry="note"]')!, field(), host.querySelector('h3')!, host.querySelector('section')!]) {
    act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
  expect(native.explorer).not.toHaveBeenCalled(); expect(native.url).not.toHaveBeenCalled();
  for (const element of [host.querySelector('h3')!, host.querySelector('form')!, host.querySelector('section')!]) {
    expect(menu(element).items).toEqual([]); await execute('complete');
  }
  props = { ...props, entries: [] }; render(); expect(menu(host.querySelector('p')!).items).toEqual([]);
  expect(props.onAdd).not.toHaveBeenCalled(); expect(writeText).not.toHaveBeenCalled();
});

it('focuses the ready draft after native path insertion', () => {
  change('before after'); field().setSelectionRange(7, 12);
  act(() => ref.current!.insertFiles(['C:\\folder\\file.txt'])); flushFrames();
  expect(field().value).toBe('before "C:\\folder\\file.txt"');
  expect(document.activeElement).toBe(field()); expect(field().selectionStart).toBe(field().value.length);
});
