// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDescriptionEditor, markdownStorage, type TaskDescriptionEditorHandle } from './TaskDescriptionEditor';
import { t } from '../../i18n';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }));

const cleanups: (() => void)[] = [];
beforeEach(() => {
  // jsdom omits Range geometry. After RAF focus, ProseMirror uses it while
  // scrolling a transaction, before it emits the editor-state notification.
  const descriptors = ['getClientRects', 'getBoundingClientRect'].map(key => [key, Object.getOwnPropertyDescriptor(Range.prototype, key)] as const);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
  cleanups.push(() => descriptors.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  }));
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

async function mount(description = '') {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const onChange = vi.fn(); const onError = vi.fn();
  const ref = createRef<TaskDescriptionEditorHandle>();
  cleanups.push(() => { act(() => root.unmount()); element.remove(); });
  await act(async () => root.render(<TaskDescriptionEditor ref={ref} taskId="t1" description={description}
    onChange={onChange} onError={onError} onEscape={vi.fn()} onContextMenu={vi.fn()} />));
  const editor = (element.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor;
  return { element, editor, onChange, onError, ref };
}

function type(editor: Editor, text: string) {
  // Exercise the same handleTextInput pipeline as native typing. jsdom has no
  // editing default action, so dispatch the ordinary insertion if unhandled.
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character, () => editor.state.tr.insertText(character, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}

function button(element: HTMLElement, label: string) {
  if (/^Überschrift [123]$/.test(label) && !element.querySelector(`button[aria-label="${t(label)}"]`)) {
    act(() => element.querySelector<HTMLButtonElement>(`button[aria-label="${t('Überschriften')}"]`)!.click());
  }
  return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(item => item.getAttribute('aria-label') === t(label))!;
}

async function click(element: HTMLElement, label: string) {
  const target = button(element, label);
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  await act(async () => target.click());
}

it.each([
  ['# heading', 'heading', { level: 1 }],
  ['## heading', 'heading', { level: 2 }],
  ['### heading', 'heading', { level: 3 }],
  ['- bullet', 'bulletList', {}],
  ['1. ordered', 'orderedList', {}],
  ['> quote', 'blockquote', {}],
  ['**bold**', 'bold', {}],
  ['__bold__', 'bold', {}],
  ['*italic*', 'italic', {}],
  ['~~strike~~', 'strike', {}],
  ['`code`', 'code', {}],
] as const)('converts typed Markdown %s through native input rules', async (text, node, attrs) => {
  const { editor, onChange, onError } = await mount();
  act(() => type(editor, text));
  // Mark input rules deliberately clear stored marks at the closing delimiter.
  if (['bold', 'italic', 'strike', 'code'].includes(node)) act(() => editor.commands.setTextSelection(2));
  expect(editor.isActive(node, attrs)).toBe(true);
  expect(editor.state.doc.textContent).toBe(text.replace(/^(?:#{1,3} |[-] |1\. |> )/, '').replace(/^[*_~`]+|[*_~`]+$/g, ''));
  expect(onChange).toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});

it.each(['- [ ] todo', '- [x] todo', '- [X] todo', '[ ] todo', '[X] todo'])('converts checklist %s without nested bullet leftovers', async text => {
  const { editor, element } = await mount();
  act(() => type(editor, text));
  expect(editor.isActive('taskList')).toBe(true);
  expect(editor.isActive('bulletList')).toBe(false);
  expect(editor.state.doc.textContent).toBe('todo');
  expect(element.querySelectorAll('input[type=checkbox]')).toHaveLength(1);
  expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(/\[[xX]\]/.test(text));
  expect(markdownStorage(editor).getMarkdown()).toBe(/\[[xX]\]/.test(text) ? '- [x] todo' : '- [ ] todo');
});

it('accepts a complete GFM checklist prefix in one input transaction', async () => {
  const { editor } = await mount();
  act(() => {
    expect(editor.view.someProp('handleTextInput', handler => handler(editor.view, 1, 1, '- [X] ', () => editor.state.tr.insertText('- [X] ', 1, 1)))).toBe(true);
    type(editor, 'todo');
  });
  expect(markdownStorage(editor).getMarkdown()).toBe('- [x] todo');
});

it.each(['```', '```mermaid', '~~~js'])('opens a typed fenced code block on Enter: %s', async fence => {
  const { editor } = await mount();
  act(() => {
    type(editor, fence);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  expect(editor.isActive('codeBlock')).toBe(true);
  expect(editor.getAttributes('codeBlock').language).toBe(fence.slice(3) || null);
});

it('pastes Markdown via the real DOM clipboard pipeline and preserves existing surrounding text', async () => {
  const { editor, element } = await mount('before after');
  act(() => editor.commands.setTextSelection(8));
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: (kind: string) => kind === 'text/plain' ? '**bold**' : '' } });
  await act(async () => editor.view.dom.dispatchEvent(paste));
  expect(paste.defaultPrevented).toBe(true);
  expect(element.querySelector('.tiptap strong')?.textContent).toBe('bold');
  expect(editor.state.doc.textContent).toBe('before boldafter');
});

it.each([
  ['Fett', 'bold', {}], ['Kursiv', 'italic', {}], ['Durchgestrichen', 'strike', {}],
  ['Überschrift 1', 'heading', { level: 1 }], ['Überschrift 2', 'heading', { level: 2 }], ['Überschrift 3', 'heading', { level: 3 }],
  ['Aufzählung', 'bulletList', {}], ['Nummerierte Liste', 'orderedList', {}],
  ['Checkliste ein-/ausschalten', 'taskList', {}], ['Zitat', 'blockquote', {}],
  ['Inline-Code', 'code', {}], ['Codeblock', 'codeBlock', {}],
] as const)('formats the retained selection with toolbar %s and reports pressed state', async (label, node, attrs) => {
  const { editor, element, onError } = await mount('selected remainder');
  act(() => editor.commands.setTextSelection({ from: 1, to: 9 }));
  const selection = { from: editor.state.selection.from, to: editor.state.selection.to };
  const target = button(element, label);
  expect(target.title).toBe(t(label)); expect(target.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect({ from: editor.state.selection.from, to: editor.state.selection.to }).toEqual(selection);
  await act(async () => target.click());
  expect(editor.isActive(node, attrs)).toBe(true);
  expect(button(element, label).getAttribute('aria-pressed')).toBe('true');
  expect(editor.state.doc.textContent).toBe('selected remainder');
  if (['bold', 'italic', 'strike', 'code'].includes(node)) {
    expect(editor.state.doc.firstChild!.firstChild!.text).toBe('selected');
    expect(editor.state.doc.firstChild!.lastChild!.marks).toHaveLength(0);
  }
  await click(element, label);
  expect(onError.mock.calls.map(([error]) => String(error))).toEqual([]);
  expect(editor.isActive(node, attrs)).toBe(false);
  expect(button(element, label).getAttribute('aria-pressed')).toBe('false');
  expect(onError).not.toHaveBeenCalled();
});

it('reports toolbar failures instead of hiding them', async () => {
  const { editor, element, onError } = await mount('preserved');
  const error = new Error('toolbar command failed');
  const chain = vi.spyOn(editor, 'chain').mockImplementation(() => { throw error; });
  try {
    await click(element, 'Fett');
    expect(onError).toHaveBeenCalledWith(error);
    expect(editor.state.doc.textContent).toBe('preserved');
  } finally { chain.mockRestore(); }
});

it('inserts Mermaid from the toolbar and exposes usable undo and redo', async () => {
  const { editor, element } = await mount();
  expect(button(element, 'Rückgängig').disabled).toBe(true);
  expect(button(element, 'Wiederholen').disabled).toBe(true);
  await click(element, 'Mermaid-Diagramm einfügen');
  expect(markdownStorage(editor).getMarkdown()).toContain('```mermaid\ngraph TD');
  expect(button(element, 'Mermaid-Diagramm einfügen').getAttribute('aria-pressed')).toBe('true');
  expect(button(element, 'Rückgängig').disabled).toBe(false);
  act(() => editor.view.dispatch(closeHistory(editor.state.tr)));
  await click(element, 'Rückgängig');
  expect(editor.state.doc.textContent).toBe('');
  expect(button(element, 'Wiederholen').disabled).toBe(false);
  await click(element, 'Wiederholen');
  expect(markdownStorage(editor).getMarkdown()).toContain('```mermaid');
});

it('does not reparse existing content while typing a heading in a later paragraph', async () => {
  const { editor } = await mount('<p><strong>preserved</strong></p><p></p>');
  const preserved = editor.state.doc.firstChild;
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); type(editor, '# new'); });
  expect(editor.state.doc.firstChild).toBe(preserved);
  expect(editor.isActive('heading', { level: 1 })).toBe(true);
});

it('keeps Markdown literal inside code and restores a heading prefix with Backspace', async () => {
  const { editor } = await mount();
  act(() => type(editor, '# '));
  expect(editor.isActive('heading')).toBe(true);
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })));
  expect(editor.isActive('heading')).toBe(false);
  expect(editor.state.doc.textContent).toBe('# ');
  act(() => { editor.commands.setContent('<pre><code></code></pre>'); type(editor, '**literal**'); });
  expect(editor.state.doc.textContent).toBe('**literal**');
  expect(editor.isActive('bold')).toBe(false);
});

it('suppresses DOM file insertion but allows native file drops to reach the window listener', async () => {
  const { editor } = await mount('unchanged');
  const nativeTransport = vi.fn(); window.addEventListener('drop', nativeTransport);
  try {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File(['text'], 'file.txt')], getData: () => '' } });
    act(() => editor.view.dom.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(nativeTransport).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe('unchanged');
  } finally { window.removeEventListener('drop', nativeTransport); }
});

async function domType(editor: Editor, text: string) {
  // jsdom has no browser editing default action. Mutate only the native DOM
  // range when beforeinput is unhandled, then let PM's observer read the input.
  for (const data of text) {
    await act(async () => {
      editor.view.focus();
      const input = new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(input);
      if (!input.defaultPrevented) {
        const selection = window.getSelection()!;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(data);
        range.insertNode(node); range.setStartAfter(node); range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
        editor.view.dom.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data, bubbles: true }));
        await Promise.resolve();
      }
    });
  }
}

it('converts native DOM beforeinput at the space, not at a lone hash, without replacing other paragraphs', async () => {
  const { editor, onError } = await mount('<p><strong>preserved</strong></p><p></p>');
  const preserved = editor.state.doc.firstChild;
  act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  await domType(editor, '#');
  expect(editor.isActive('heading')).toBe(false);
  await domType(editor, ' heading');
  expect(editor.isActive('heading', { level: 1 })).toBe(true);
  expect(editor.state.doc.lastChild!.textContent).toBe('heading');
  expect(editor.state.doc.firstChild).toBe(preserved);
  expect(onError).not.toHaveBeenCalled();
});

it('does not intercept composition text and lets the existing compositionend rules convert the completed prefix', async () => {
  const { editor } = await mount();
  act(() => { editor.view.focus(); editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  const composing = new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '# ', isComposing: true, bubbles: true, cancelable: true });
  act(() => editor.view.dom.dispatchEvent(composing));
  expect(composing.defaultPrevented).toBe(false);
  act(() => editor.view.dispatch(editor.state.tr.insertText('# ')));
  expect(editor.isActive('heading')).toBe(false);
  await act(async () => {
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { data: '# ', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(editor.isActive('heading')).toBe(true);
});

it('focuses dropped paths synchronously, leaves caret after the path and separates subsequent typing undo', async () => {
  const { editor, ref, onChange, element } = await mount('before ');
  act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  act(() => ref.current!.insertFiles(['C:\\drop.txt']));
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  expect(onChange.mock.lastCall![1]).toMatchObject({ historyBoundary: true });
  const inserted = editor.state.doc.textContent;
  await domType(editor, ' suffix');
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
  expect(editor.state.doc.textContent).toBe(inserted);
  expect(onChange.mock.lastCall![1]).toMatchObject({ localUndo: true });
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
  expect(editor.state.doc.textContent).toBe('before');
  expect(element.querySelector('[data-description-editor]')!.className).toContain('overflow-hidden');
  expect(element.querySelector('.tiptap')!.parentElement!.className).toContain('overflow-y-auto');
});

it('separates DOM paste from adjacent typing history and reports a persistence boundary', async () => {
  const { editor, onChange } = await mount();
  await domType(editor, 'before');
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: (kind: string) => kind === 'text/plain' ? '**pasted**' : '' } });
  act(() => editor.view.dom.dispatchEvent(paste));
  expect(onChange.mock.lastCall![1]).toMatchObject({ historyBoundary: true });
  const pasted = editor.state.doc.textContent;
  await domType(editor, 'after');
  act(() => editor.commands.undo()); expect(editor.state.doc.textContent).toBe(pasted);
  act(() => editor.commands.undo()); expect(editor.state.doc.textContent).toBe('before');
});

it('offers headings as a compact disclosure with paragraph reset and dismisses it outside the toolbar', async () => {
  const { element, editor } = await mount('text');
  expect(element.querySelector(`button[aria-label="${t('Überschrift 1')}"]`)).toBeNull();
  await click(element, 'Überschriften');
  expect(button(element, 'Überschriften').getAttribute('aria-expanded')).toBe('true');
  await click(element, 'Überschrift 2');
  expect(editor.isActive('heading', { level: 2 })).toBe(true);
  expect(button(element, 'Überschriften').getAttribute('aria-expanded')).toBe('false');
  await click(element, 'Überschriften');
  await click(element, 'Absatz');
  expect(editor.isActive('paragraph')).toBe(true);
  await click(element, 'Überschriften');
  act(() => editor.view.dom.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(button(element, 'Überschriften').getAttribute('aria-expanded')).toBe('false');
});
