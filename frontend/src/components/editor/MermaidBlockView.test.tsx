// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDescriptionEditor, markdownStorage } from './TaskDescriptionEditor';
import { t } from '../../i18n';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>' })) }));
vi.mock('mermaid', () => ({ default: mermaid }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const cleanups: (() => void)[] = [];
beforeEach(() => {
  const descriptors = ['getClientRects', 'getBoundingClientRect'].map(key => [key, Object.getOwnPropertyDescriptor(Range.prototype, key)] as const);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  cleanups.push(() => descriptors.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  }));
  const hitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  cleanups.push(() => {
    if (hitTest) Object.defineProperty(document, 'elementFromPoint', hitTest);
    else Reflect.deleteProperty(document, 'elementFromPoint');
  });
});
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()));

async function mount(description: string) {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const props = { taskId: 't1', onChange: vi.fn(), onEscape: vi.fn(), onError: vi.fn(), onContextMenu: vi.fn() };
  cleanups.push(() => { act(() => root.unmount()); element.remove(); });
  await act(async () => root.render(<TaskDescriptionEditor {...props} description={description} />));
  const editor = (element.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor;
  return { element, root, props, editor };
}

async function click(button: HTMLElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    if (!down.defaultPrevented) button.focus();
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    button.click();
  });
}

it('loads Mermaid only for Mermaid code, renders strict SVG and exposes in-place source editing', async () => {
  const { element, root, props, editor } = await mount('```js\nconst a = 1;\n```');
  expect(mermaid.initialize).not.toHaveBeenCalled();
  await act(async () => root.render(<TaskDescriptionEditor {...props} description={'```mermaid\ngraph TD\n  A --> B\n```'} />));
  expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }));
  expect(mermaid.render).toHaveBeenCalled(); expect(element.querySelector('[role=img] svg')).not.toBeNull();
  const preview = element.querySelector<HTMLElement>('[role=img]')!;
  expect(preview.getAttribute('aria-label')).toBe(t('Mermaid-Vorschau'));
  // jsdom's CSSStyleDeclaration has no zoom support; React assigns the value
  // directly. The browser test separately verifies real layout shrinking.
  expect(preview.style.zoom).toBe('0.75');
  expect(preview.style.transform).toBe('');
  expect(element.querySelector<HTMLElement>('.mermaid-body')!.style.getPropertyValue('zoom')).toBe('');
  await click(Array.from(element.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === t('Mermaid-Diagramm bearbeiten'))!);
  expect(element.querySelector('[data-mermaid-editing]')).not.toBeNull();
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.state.selection.from).toBe(1);
  const source = element.querySelector<HTMLElement>('[data-node-view-content-react]')!;
  expect(window.getSelection()!.anchorNode).not.toBeNull();
  expect(source.contains(window.getSelection()!.anchorNode)).toBe(true);
  expect(source.closest('pre')!.className).not.toContain('hidden');
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => editor.view.dom.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(element.querySelector('[data-mermaid-editing]')).toBeNull();
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(props.onEscape).not.toHaveBeenCalled();
});

it('edits the real content DOM without reparsing other nodes and regenerates the diagram on blur', async () => {
  const { element, editor, props } = await mount('```mermaid\ngraph TD\n A --> B\n```\n\n**preserved**');
  const preserved = editor.state.doc.lastChild;
  await click(Array.from(element.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === t('Mermaid-Diagramm bearbeiten'))!);
  const renderCount = mermaid.render.mock.calls.length;
  await act(async () => {
    // jsdom lacks contenteditable's default action. Mutate the native selection,
    // then let ProseMirror's DOM observer produce the real editor transaction.
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);
    const text = document.createTextNode('%% edited\n');
    range.insertNode(text); range.setStartAfter(text); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    editor.view.dom.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
    await Promise.resolve();
  });
  expect(editor.state.doc.firstChild!.textContent).toBe('%% edited\ngraph TD\n A --> B');
  expect(editor.state.doc.lastChild).toBe(preserved);
  expect(markdownStorage(editor).getMarkdown()).toContain('%% edited');
  expect(props.onChange).toHaveBeenCalled();
  expect(mermaid.render.mock.calls.length).toBe(renderCount);
  await act(async () => editor.view.dom.blur());
  expect(element.querySelector('[data-mermaid-editing]')).toBeNull();
  expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), '%% edited\ngraph TD\n A --> B', expect.any(HTMLElement));
  expect(props.onError).not.toHaveBeenCalled();
});

it('keeps source editing open when typing beyond the old node size and closes it on another paragraph', async () => {
  const { element, editor } = await mount('```mermaid\ngraph TD\n A --> B\n```\n\nother');
  await click(Array.from(element.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === t('Mermaid-Diagramm bearbeiten'))!);
  const originalSize = editor.state.doc.firstChild!.nodeSize;
  await act(async () => {
    editor.commands.setTextSelection(originalSize - 1);
    editor.view.dispatch(editor.state.tr.insertText('\n%% a longer comment appended at the end'));
  });
  expect(element.querySelector('[data-mermaid-editing]')).not.toBeNull();
  expect(document.activeElement).toBe(editor.view.dom);
  await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  expect(element.querySelector('[data-mermaid-editing]')).toBeNull();
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
});

it.each(['Backspace', 'Delete'])('selects a diagram by clicking its preview and deletes it with %s', async key => {
  const { element, editor } = await mount('```mermaid\ngraph TD\n A --> B\n```');
  await click(element.querySelector<HTMLElement>('[role=img]')!);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(document.activeElement).toBe(editor.view.dom);
  expect(element.querySelector('[data-mermaid-selected]')).not.toBeNull();
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => editor.view.dom.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(element.querySelector('[data-mermaid-block]')).toBeNull();
  expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
  expect(markdownStorage(editor).getMarkdown()).toBe('');
});

it.each(['.mermaid-body', '[data-mermaid-title]', '[data-mermaid-title] span'])('selects the complete diagram by clicking %s', async selector => {
  const { element, editor } = await mount('```mermaid\ngraph TD\n A --> B\n```');
  await click(element.querySelector<HTMLElement>(selector)!);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.from).toBe(0);
  expect(document.activeElement).toBe(editor.view.dom);
  const title = element.querySelector('[data-mermaid-title]')!;
  expect(title.textContent).toBe(`Mermaid:${t('bearbeiten')}|${t('löschen')}`);
});

it('selects a failed diagram through its error message but keeps editable source clicks as text selection', async () => {
  mermaid.render.mockRejectedValueOnce(new Error('Parse error'));
  const { element, editor } = await mount('```mermaid\nbroken\n```');
  await click(element.querySelector<HTMLElement>('[role=alert]')!);
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  const editButton = element.querySelector<HTMLButtonElement>(`button[aria-label="${t('Mermaid-Diagramm bearbeiten')}"]`)!;
  await click(editButton);
  const source = element.querySelector<HTMLElement>('[data-node-view-content-react]')!;
  await click(source);
  expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
  expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
});

it('selects diagram background before delegating to the native copy menu', async () => {
  const { element, editor, props } = await mount('```mermaid\ngraph TD\n A --> B\n```\n\nother');
  await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await act(async () => element.querySelector('.mermaid-body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  const menu = props.onContextMenu.mock.lastCall![1];
  expect(menu.items.find((item: { id: string }) => item.id === 'editor:copy')?.disabled).toBe(false);
});

it('deletes through the accessible NodeView control and supports undo', async () => {
  const { element, editor } = await mount('```mermaid\ngraph TD\n A --> B\n```');
  await click(Array.from(element.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === t('Mermaid-Diagramm löschen'))!);
  expect(element.querySelector('[data-mermaid-block]')).toBeNull();
  expect(document.activeElement).toBe(editor.view.dom);
  await act(async () => editor.commands.undo());
  expect(element.querySelector('[data-mermaid-block]')).not.toBeNull();
});

it.each(['before', 'between', 'after'])('allows pointer insertion and typing %s diagrams in a diagrams-only document', async location => {
  const { element, editor } = await mount('```mermaid\ngraph TD\n A --> B\n```\n\n```mermaid\ngraph TD\n C --> D\n```');
  const diagrams = [editor.state.doc.firstChild, editor.state.doc.lastChild];
  const blocks = element.querySelectorAll('[data-mermaid-block]');
  const index = location === 'after' ? 1 : 0;
  const side = location === 'before' ? 'before' : 'after';
  const control = blocks[index].querySelector<HTMLElement>(`[data-mermaid-insert=${side}]`)!;
  expect(control.getAttribute('aria-label')).toBe(t(side === 'before' ? 'Absatz vor Mermaid-Diagramm einfügen' : 'Absatz nach Mermaid-Diagramm einfügen'));
  await click(control);
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  await act(async () => editor.view.dispatch(editor.state.tr.insertText(location)));
  const nodes = Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i));
  expect(nodes.filter(node => node.type.name === 'codeBlock')).toEqual(diagrams);
  expect(nodes.findIndex(node => node.type.name === 'paragraph')).toBe(location === 'before' ? 0 : location === 'between' ? 1 : 2);
  expect(editor.state.doc.textContent).toContain(location);
  // The opposite boundary must reuse this paragraph rather than add blank lines.
  if (location === 'between') {
    await click(element.querySelectorAll('[data-mermaid-block]')[1].querySelector<HTMLElement>('[data-mermaid-insert=before]')!);
    expect(editor.state.doc.childCount).toBe(3);
    expect(editor.state.selection.$from.parent.textContent).toBe('between');
  }
  expect(element.querySelector('style')!.textContent).toContain('.ProseMirror-gapcursor:after');
});

it('keeps checklist checkbox and text inline without adding a document newline', async () => {
  const { element, editor } = await mount('- [ ] todo');
  const item = element.querySelector<HTMLElement>('li[data-type=taskItem]')!;
  const label = item.querySelector('label')!;
  const paragraph = item.querySelector('p')!;
  expect(getComputedStyle(item).display).toBe('flex');
  expect(getComputedStyle(label).display).toBe('inline-flex');
  expect(getComputedStyle(label.querySelector('span')!).display).toBe('inline-block');
  expect(getComputedStyle(paragraph).marginTop).toBe('0px');
  expect(getComputedStyle(paragraph).marginBottom).toBe('0px');
  expect(item.querySelectorAll('p')).toHaveLength(1);
  await click(label.querySelector('input')!);
  expect(markdownStorage(editor).getMarkdown()).toBe('- [x] todo');
  expect(item.querySelectorAll('p')).toHaveLength(1);
});
