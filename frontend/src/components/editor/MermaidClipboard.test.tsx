// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDescriptionEditor, markdownStorage } from './TaskDescriptionEditor';
import type { EditorContextMenu } from './types';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg><text>diagram</text></svg>' })) } }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const source = 'flowchart TD\n  A["Copy & paste"] --> B{"Keep <source>?"}\n\n  %% retain indentation\n  B --> C';
const fenced = `\`\`\`mermaid\n${source}\n\`\`\``;
const cleanups: (() => void)[] = [];

class ClipboardData {
  private data = new Map<string, string>();
  files: File[] = [];
  get types() { return [...this.data.keys()]; }
  getData(type: string) { return this.data.get(type) ?? ''; }
  setData(type: string, value: string) { this.data.set(type, value); }
  clearData(type?: string) { if (type) this.data.delete(type); else this.data.clear(); }
}

beforeEach(() => {
  for (const [object, key, value] of [
    [Range.prototype, 'getClientRects', () => []],
    [Range.prototype, 'getBoundingClientRect', () => new DOMRect()],
    [document, 'elementFromPoint', () => null],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, value });
    cleanups.push(() => {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    });
  }
});
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()));

async function mount(description = `${fenced}\n\ntarget`) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const onChange = vi.fn(); const onError = vi.fn(); const onContextMenu = vi.fn();
  cleanups.push(() => { act(() => root.unmount()); element.remove(); });
  await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description={description}
    onChange={onChange} onError={onError} onEscape={vi.fn()} onContextMenu={onContextMenu} />));
  const editor = (element.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor;
  return { element, editor, onChange, onError, onContextMenu };
}

async function selectDiagram(element: HTMLElement, editor: Editor) {
  const preview = element.querySelector<HTMLElement>('[role=img]')!;
  await act(async () => {
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    preview.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    preview.click();
  });
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(document.activeElement).toBe(editor.view.dom);
}

async function clipboardEvent(editor: Editor, action: 'copy' | 'cut' | 'paste', data: ClipboardData, target: HTMLElement = editor.view.dom) {
  // jsdom has no system clipboard shortcut default action. Dispatch the DOM
  // clipboard event that Windows/WebView2 delivers after the unhandled shortcut.
  const key = new KeyboardEvent('keydown', { key: action === 'copy' ? 'c' : action === 'cut' ? 'x' : 'v', ctrlKey: true, bubbles: true, cancelable: true });
  const event = new Event(action, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  await act(async () => {
    target.dispatchEvent(key);
    target.dispatchEvent(event);
  });
  expect(key.defaultPrevented).toBe(false);
  expect(event.defaultPrevented).toBe(true);
}

function expectSource(data: ClipboardData) {
  expect(data.getData('text/plain')).toBe(fenced);
  const html = document.createElement('div'); html.innerHTML = data.getData('text/html');
  expect(html.querySelector('pre > code.language-mermaid')?.textContent).toBe(source);
  expect(html.querySelector('svg')).toBeNull();
}

async function expectPersistedDiagram(editor: Editor, onChange: ReturnType<typeof vi.fn>, count: number) {
  const diagrams = () => Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i)).filter(node => node.type.name === 'codeBlock');
  expect(diagrams()).toHaveLength(count);
  for (const node of diagrams()) {
    expect(node.attrs.language).toBe('mermaid');
    expect(node.textContent).toBe(source);
  }
  expect(editor.state.doc.textContent).toContain('target');
  const saved = onChange.mock.lastCall![0] as string;
  expect(saved).toBe(markdownStorage(editor).getMarkdown());
  expect(saved.split('```mermaid')).toHaveLength(count + 1);
  expect(onChange.mock.lastCall![1]).toMatchObject({ historyBoundary: true });
  const reloaded = await mount(saved);
  expect(reloaded.element.querySelectorAll('[data-mermaid-block]')).toHaveLength(count);
  expect(reloaded.element.querySelectorAll('[role=img] svg')).toHaveLength(count);
  expect(reloaded.editor.getJSON()).toEqual(editor.getJSON());
  expect(reloaded.onError).not.toHaveBeenCalled();
}

it.each([
  ['copy', 'rich'], ['copy', 'plain'], ['cut', 'rich'], ['cut', 'plain'],
] as const)('uses standard Ctrl clipboard events to %s full Mermaid source and paste a real node (%s)', async (action, format) => {
  const { element, editor, onChange, onError } = await mount();
  await selectDiagram(element, editor);
  const data = new ClipboardData();
  await clipboardEvent(editor, action, data);
  expectSource(data);
  expect(element.querySelectorAll('[data-mermaid-block]')).toHaveLength(action === 'copy' ? 1 : 0);
  if (format === 'plain') data.clearData('text/html');
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  await clipboardEvent(editor, 'paste', data);
  await expectPersistedDiagram(editor, onChange, action === 'copy' ? 2 : 1);
  expect(onError).not.toHaveBeenCalled();
});

it.each(['copy', 'cut'] as const)('serializes the selected model when %s originates from Mermaid controls rather than the editor root', async action => {
  const { element, editor, onChange, onError } = await mount();
  await selectDiagram(element, editor);
  const control = element.querySelector<HTMLButtonElement>('[data-mermaid-title] button')!;
  // A native focused control can own the DOM clipboard event while PM retains
  // the selected block. The browser default would copy the preview's UI text.
  act(() => control.focus());
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  const data = new ClipboardData();
  await clipboardEvent(editor, action, data, control);
  expectSource(data);
  expect(data.getData('text/html')).not.toContain('bearbeiten');
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  await clipboardEvent(editor, 'paste', data);
  await expectPersistedDiagram(editor, onChange, action === 'copy' ? 2 : 1);
  expect(onError).not.toHaveBeenCalled();
});

it('keeps fenced clipboard text raw when pasting into an existing code block', async () => {
  const { editor, element } = await mount('```js\nexisting\n```');
  act(() => { editor.commands.setTextSelection(1); editor.view.focus(); });
  const data = new ClipboardData(); data.setData('text/plain', fenced);
  await clipboardEvent(editor, 'paste', data);
  expect(editor.state.doc.childCount).toBe(1);
  expect(editor.state.doc.firstChild!.attrs.language).toBe('js');
  expect(editor.state.doc.firstChild!.textContent).toBe(`${fenced}existing`);
  expect(element.querySelector('[data-mermaid-block]')).toBeNull();
});

it('preserves ordinary plaintext and prefers schema-parsed HTML over fenced plaintext', async () => {
  const { editor, element } = await mount('');
  act(() => editor.view.focus());
  const data = new ClipboardData(); data.setData('text/plain', 'ordinary clipboard text');
  await clipboardEvent(editor, 'paste', data);
  expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
  expect(editor.state.doc.textContent).toBe('ordinary clipboard text');
  data.setData('text/plain', fenced);
  data.setData('text/html', '<p><strong>preferred HTML</strong><script>untrusted()</script></p>');
  await clipboardEvent(editor, 'paste', data);
  expect(element.querySelector('.tiptap strong')?.textContent).toBe('preferred HTML');
  expect(element.querySelector('.tiptap script')).toBeNull();
  expect(element.querySelector('[data-mermaid-block]')).toBeNull();
  expect(editor.state.doc.textContent).not.toContain('untrusted()');
});

function nativeClipboard(data: ClipboardData, rich: boolean) {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  const writeText = vi.fn(async (text: string) => data.setData('text/plain', text));
  const write = vi.fn(async (items: { data: Record<string, Blob> }[]) => {
    for (const [type, blob] of Object.entries(items[0].data)) {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsText(blob);
      });
      data.setData(type, text);
    }
  });
  const readText = vi.fn(async () => data.getData('text/plain'));
  const read = vi.fn(async () => [{ types: data.types, getType: async (type: string) => ({ text: async () => data.getData(type) }) }]);
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: rich ? class {
    constructor(public data: Record<string, Blob>) {}
  } : undefined });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: rich ? { write, read } : { writeText, readText } });
  cleanups.push(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else Reflect.deleteProperty(navigator, 'clipboard');
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor); else Reflect.deleteProperty(globalThis, 'ClipboardItem');
  });
  return { write, read, writeText, readText };
}

it.each([
  ['copy', true], ['copy', false], ['cut', true], ['cut', false],
] as const)('uses native menu %s and paste with complete Mermaid source (rich clipboard: %s)', async (action, rich) => {
  const data = new ClipboardData();
  const clipboard = nativeClipboard(data, rich);
  const { element, editor, onChange, onError, onContextMenu } = await mount();
  // A right-click must select the diagram under the pointer, not copy the old caret.
  act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  const contextmenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => element.querySelector('[role=img]')!.dispatchEvent(contextmenu));
  expect(contextmenu.defaultPrevented).toBe(true);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  const menu = onContextMenu.mock.lastCall![1] as EditorContextMenu;
  expect(menu.items.find(item => item.id === `editor:${action}`)?.disabled).toBe(false);
  await act(async () => menu.execute(`editor:${action}`));
  expect(data.getData('text/plain')).toBe(fenced);
  if (rich) { expectSource(data); expect(clipboard.write).toHaveBeenCalledOnce(); }
  else expect(clipboard.writeText).toHaveBeenCalledWith(fenced);
  expect(element.querySelectorAll('[data-mermaid-block]')).toHaveLength(action === 'copy' ? 1 : 0);
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  await act(async () => element.querySelector('.tiptap p')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const pasteMenu = onContextMenu.mock.lastCall![1] as EditorContextMenu;
  await act(async () => pasteMenu.execute('editor:paste'));
  if (rich) expect(clipboard.read).toHaveBeenCalledOnce(); else expect(clipboard.readText).toHaveBeenCalledOnce();
  await expectPersistedDiagram(editor, onChange, action === 'copy' ? 2 : 1);
  expect(onError).not.toHaveBeenCalled();
});
