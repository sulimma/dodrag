// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDescriptionEditor, markdownStorage, type TaskDescriptionEditorHandle } from './TaskDescriptionEditor';
import { getLanguage, setLanguage, supportedLanguages, t } from '../../i18n';
import { MERMAID_TEMPLATES } from './MermaidTemplates';
import { SYMBOL_GROUPS } from './SymbolReplacements';

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
  const group = /^(Überschrift [123]|Absatz)$/.test(label) ? 'Überschriften'
    : ['Fett', 'Kursiv', 'Durchgestrichen', 'Inline-Code', 'Formel'].includes(label) ? 'Format'
    : ['Aufzählung', 'Nummerierte Liste', 'Checkliste ein-/ausschalten'].includes(label) ? 'Listen'
    : ['Zitat', 'Codeblock', 'Formelblock', 'Note', 'Warning', 'Important', 'Tip', 'Caution'].includes(label) ? 'Block'
    : MERMAID_TEMPLATES.some(item => item.labelKey === label) ? 'Mermaid' : null;
  if (group && !element.querySelector(`button[aria-label="${t(label)}"]`)) {
    act(() => element.querySelector<HTMLButtonElement>(`button[aria-label="${t(group)}"]`)!.click());
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
  expect(target.title).not.toBe(''); expect(target.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
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

it.each([
  ['Absatz', 'paragraph', {}, 'Ctrl+Alt+0'],
  ['Überschrift 1', 'heading', { level: 1 }, 'Ctrl+Alt+1'],
  ['Überschrift 2', 'heading', { level: 2 }, 'Ctrl+Alt+2'],
  ['Überschrift 3', 'heading', { level: 3 }, 'Ctrl+Alt+3'],
  ['Fett', 'bold', {}, 'Ctrl+B'], ['Kursiv', 'italic', {}, 'Ctrl+I'],
  ['Durchgestrichen', 'strike', {}, 'Ctrl+Shift+S'], ['Inline-Code', 'code', {}, 'Ctrl+E'],
  ['Aufzählung', 'bulletList', {}, 'Ctrl+Shift+8'], ['Nummerierte Liste', 'orderedList', {}, 'Ctrl+Shift+7'],
  ['Checkliste ein-/ausschalten', 'taskList', {}, 'Ctrl+Shift+9'],
  ['Zitat', 'blockquote', {}, 'Ctrl+Shift+B'], ['Codeblock', 'codeBlock', {}, 'Ctrl+Alt+C'],
] as const)('shows the working shortcut for %s in every language without replacing syntax hints', async (label, node, attrs, shortcut) => {
  const { editor, element } = await mount('selected');
  const previous = getLanguage();
  try {
    for (const language of supportedLanguages) {
      act(() => setLanguage(language));
      const target = button(element, label);
      expect(target.querySelector('kbd')?.textContent).toBe(shortcut);
      expect(target.getAttribute('aria-label')).toBe(t(label));
      expect(target.title).not.toContain('Ctrl+');
    }
    await act(async () => {
      if (node === 'paragraph') editor.commands.toggleHeading({ level: 1 });
      editor.commands.setTextSelection({ from: 1, to: 9 });
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
        key: shortcut.split('+').at(-1)!.toLowerCase(), ctrlKey: true,
        shiftKey: shortcut.includes('Shift'), altKey: shortcut.includes('Alt'),
        bubbles: true, cancelable: true,
      }));
    });
    expect(editor.isActive(node, attrs)).toBe(true);
  } finally { act(() => setLanguage(previous)); }
});

it('inserts the supplied emoticon shortcuts from the insertion menu and keeps their Markdown spelling', async () => {
  const { editor, element, onError } = await mount();
  await click(element, 'Sonderzeichen');
  const target = element.querySelector<HTMLButtonElement>('[data-editor-dropdown] button[title="(*r)"]')!;
  await act(async () => target.click());
  expect(editor.state.doc.firstChild!.firstChild!.type.name).toBe('emoticon');
  expect(editor.state.doc.firstChild!.firstChild!.attrs.shortcut).toBe('(*r)');
  expect(markdownStorage(editor).getMarkdown()).toBe('(*r)');
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
  await click(element, MERMAID_TEMPLATES[0].labelKey);
  expect(editor.state.doc.firstChild!.attrs.language).toBe('mermaid');
  expect(editor.state.doc.firstChild!.textContent).toBe(MERMAID_TEMPLATES[0].source);
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

it('completes symbols and arbitrary fractions on Enter without requiring a trailing space', async () => {
  const { editor, onError } = await mount();
  for (const [source, expected] of [
    ['17/34', '$\\frac{17}{34}$'], ['1/3', '$\\frac{1}{3}$'], ['1/2', '\u00bd'],
    ['->', '\u2192'], ['=>', '\u21d2'], ['!=', '\u2260'], ['--', '\u2014'],
  ]) {
    await domType(editor, source);
    const index = editor.state.doc.childCount - 1;
    act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(editor.markdown!.serialize(editor.state.doc.child(index).toJSON()), source).toBe(expected);
    expect(editor.state.doc.lastChild!.textContent).toBe('');
    expect(editor.state.selection.$from.parent).toBe(editor.state.doc.lastChild);
  }
  expect(onError).not.toHaveBeenCalled();
});

it.each(['[!TIP]', '> [!TIP]'])('opens a typed alert on Enter: %s', async source => {
  const { editor, element } = await mount();
  await domType(editor, source);
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  await domType(editor, 'Keep the next action small');
  expect(element.querySelector('[data-alert="TIP"]')).not.toBeNull();
  expect(editor.getMarkdown()).toBe('> [!TIP]\n> Keep the next action small');
  expect(editor.state.doc.textContent).toBe('Keep the next action small');
});

it('keeps Enter replacements out of code, links, paths, dates and unfinished math', async () => {
  for (const source of ['dir/1/2', '12/34/56', '1/0', '$1/2', '-->']) {
    const { editor } = await mount();
    await domType(editor, source);
    act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(editor.state.doc.firstChild!.textContent).toBe(source);
    expect(editor.view.dom.querySelector('[data-type=inline-math]')).toBeNull();
  }
  const { editor } = await mount();
  act(() => { editor.commands.toggleCodeBlock(); type(editor, '[!TIP] 1/2 ->'); });
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(editor.state.doc.firstChild!.type.name).toBe('codeBlock');
  expect(editor.state.doc.firstChild!.textContent).toBe('[!TIP] 1/2 ->\n');
  const linked = await mount('[1/2](https://host.test)');
  act(() => { linked.editor.commands.setTextSelection(4); linked.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  expect(linked.editor.state.doc.firstChild!.textContent).toBe('1/2');
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
  expect(editor.state.doc.textContent).toBe('before ');
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

it('groups formatting and insertion entries with syntax tooltips and keyboard dismissal', async () => {
  const { element } = await mount('text');
  expect(button(element, 'Sonderzeichen').textContent).toBe('Zeichen');
  expect(button(element, 'Listen').textContent).toBe('Liste');
  for (const label of ['Überschriften', 'Format', 'Listen', 'Block', 'Sonderzeichen', 'Mermaid']) {
    expect(button(element, label).getAttribute('aria-expanded')).toBe('false');
    expect(button(element, label).title).not.toBe('');
  }
  await click(element, 'Format');
  expect(button(element, 'Fett').title).toBe(`**${t('Fett')}**`);
  expect(button(element, 'Inline-Code').title).toBe('`code`');
  expect(element.querySelector('[data-editor-dropdown] button[title="$E = mc^2$"]')?.getAttribute('aria-label')).toBe(t('Formel'));
  await click(element, 'Listen');
  expect(button(element, 'Format').getAttribute('aria-expanded')).toBe('false');
  expect(button(element, 'Aufzählung').title).toBe(`- ${t('Text')}`);
  await click(element, 'Block');
  expect(element.querySelector(`[data-editor-dropdown] button[aria-label="${t('Formelblock')}"]`)?.getAttribute('title')).toBe('$$\nE = mc^2\n$$');
  for (const [key, type] of [['Note', 'NOTE'], ['Warning', 'WARNING'], ['Important', 'IMPORTANT'], ['Tip', 'TIP'], ['Caution', 'CAUTION']]) {
    expect(button(element, key).title).toBe(`> [!${type}]\n> ${t('Text')}`);
  }
  act(() => button(element, 'Block').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(button(element, 'Block').getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button(element, 'Block'));
  await click(element, 'Sonderzeichen');
  expect(element.textContent).toContain(t('Emotion-Shortcuts'));
  expect(element.querySelectorAll('[data-editor-dropdown] button')).toHaveLength(23 + SYMBOL_GROUPS.reduce((sum, group) => sum + group.items.length, 0));
  for (const grid of element.querySelectorAll('[data-symbol-group],[data-emoticon-group]')) expect(grid.classList.contains('grid-cols-3')).toBe(true);
  expect(element.querySelector(`[data-editor-dropdown] button[aria-label="${t('Formel')}"]`)).toBeNull();
  expect(element.querySelector(`[data-editor-dropdown] button[aria-label="${t('Formelblock')}"]`)).toBeNull();
  for (const shortcut of [':)', ':(', ':P', ':D', ';)', '(y)', '(n)', '(on)', '(off)', '(!)', '(*)', '(*r)', '(*g)', '(*b)', '(*y)', '(/)', '(x)', '(i)', '(+)', '(-)', '(?)', '<3', '</3']) {
    const entry = element.querySelector<HTMLButtonElement>(`[data-editor-dropdown] button[title="${shortcut}"]`)!;
    expect(entry.getAttribute('aria-label')).toBe(shortcut);
    expect(entry.childNodes).toHaveLength(2);
    expect(entry.lastChild!.textContent).toBe(shortcut);
  }
});

it.each(['Note', 'Warning', 'Important', 'Tip', 'Caution'])('wraps the selected paragraph with %s from the block menu', async key => {
  const { editor, element, onError } = await mount('selected');
  await click(element, key);
  expect(editor.isActive('alert', { type: key.toUpperCase() })).toBe(true);
  expect(markdownStorage(editor).getMarkdown()).toContain(`> [!${key.toUpperCase()}]`);
  expect(editor.state.doc.textContent).toBe('selected');
  expect(onError).not.toHaveBeenCalled();
});

it('moves through dropdown entries with arrow keys', async () => {
  const { element } = await mount();
  act(() => button(element, 'Format').focus());
  await act(async () => {
    button(element, 'Format').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  expect(document.activeElement).toBe(button(element, 'Fett'));
  await act(async () => {
    button(element, 'Fett').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  expect(document.activeElement).toBe(button(element, 'Formel'));
});

it('changes an existing alert kind without losing its text or nesting another box', async () => {
  const { editor, element } = await mount('preserved');
  await click(element, 'Note');
  await click(element, 'Warning');
  expect(editor.state.doc.firstChild!.type.name).toBe('alert');
  expect(editor.state.doc.firstChild!.attrs.type).toBe('WARNING');
  expect(editor.state.doc.firstChild!.firstChild!.type.name).toBe('paragraph');
  expect(editor.state.doc.textContent).toBe('preserved');
  await click(element, 'Warning');
  expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
});

it.each([['Formel', 'inlineMath'], ['Formelblock', 'blockMath']])('inserts %s with editable LaTeX data', async (label, nodeType) => {
  const { editor, element, onError } = await mount();
  await click(element, label);
  let latex: string | undefined;
  editor.state.doc.descendants(node => { if (node.type.name === nodeType) latex = node.attrs.latex; });
  expect(latex).toBe('E = mc^2');
  expect(markdownStorage(editor).getMarkdown()).toContain('E = mc^2');
  expect(onError).not.toHaveBeenCalled();
});

it.each(MERMAID_TEMPLATES)('inserts the tiny $labelKey template from the separate Mermaid menu', async item => {
  const { editor, element, onError } = await mount();
  await click(element, 'Mermaid');
  expect(element.querySelector('[data-symbol-group]')).toBeNull();
  const entries = element.querySelectorAll('[data-editor-dropdown] button');
  expect(entries).toHaveLength(MERMAID_TEMPLATES.length);
  const entry = button(element, item.labelKey);
  expect(entry.querySelector('code')).toBeNull();
  expect(entry.textContent).toBe(t(item.labelKey));
  expect(entry.title).toBe(`\`\`\`mermaid\n${item.source}\n\`\`\``);
  await act(async () => entry.click());
  expect(editor.state.doc.firstChild!.attrs.language).toBe('mermaid');
  expect(editor.state.doc.firstChild!.textContent).toBe(item.source);
  expect(onError).not.toHaveBeenCalled();
});

it.each(SYMBOL_GROUPS.flatMap(group => group.items))('inserts special character $shortcut from the three-column palette', async item => {
  const { editor, element, onError } = await mount();
  await click(element, 'Sonderzeichen');
  const entry = [...element.querySelectorAll<HTMLButtonElement>('[data-symbol-group] button')].find(button => button.getAttribute('aria-label') === item.shortcut)!;
  expect(entry.closest('[data-symbol-group]')?.classList.contains('grid-cols-3')).toBe(true);
  expect(entry.querySelector('span')?.textContent).toBe(item.symbol);
  const shortcut = entry.querySelector('code')!;
  expect(shortcut.textContent).toBe(item.shortcut);
  expect(shortcut.style.fontVariantLigatures).toBe('none');
  expect(shortcut.style.fontFeatureSettings).toBe('"liga" 0, "clig" 0, "calt" 0');
  await act(async () => entry.click());
  if (item.latex) expect(editor.state.doc.firstChild!.firstChild!.attrs.latex).toBe(item.latex);
  else expect(editor.state.doc.textContent).toBe(item.symbol);
  expect(onError).not.toHaveBeenCalled();
});

it('navigates the three-column special-character palette by rows and columns', async () => {
  const { element } = await mount();
  await click(element, 'Sonderzeichen');
  const entries = [...element.querySelectorAll<HTMLButtonElement>('[data-editor-dropdown] button')];
  act(() => entries[0].focus());
  act(() => entries[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(entries[3]);
  act(() => entries[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(entries[4]);
  act(() => entries[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(entries[3]);
});

it.each(['06917320 2564', '+49 (30) 1234_5678', 'mailto:kolja@solimma.de', 'kolja+tag@solimma.de.extra', '"mail # ? % /"@solimma.de'])('keeps a growing source together: %s', async value => {
  const { editor, element } = await mount();
  for (const character of value) {
    act(() => type(editor, character));
    expect(element.querySelector('[data-target-literal]')).toBeNull();
    expect(editor.state.doc.firstChild!.childCount).toBe(1);
  }
  expect(editor.state.doc.textContent).toBe(value);
  expect(editor.state.doc.firstChild!.childCount).toBe(1);
  expect(element.querySelectorAll('[data-source-drag]')).toHaveLength(1);
  expect(element.querySelector('[data-source-drag]')!.compareDocumentPosition(element.querySelector('[data-target-kind]:not([data-source-drag])')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  act(() => type(editor, '!'));
  expect(editor.state.doc.textContent).toBe(`${value}!`);
  expect(editor.state.doc.firstChild!.firstChild!.type.name).toBe('targetLiteral');
});

it.each([false, true].flatMap(loaded => ['06917320 2564', 'person+tag@example.org', '"mail # ? % /"@example.org'].map(value => ({ loaded, value }))))('first Backspace removes source formatting, then one character (loaded=$loaded, $value)', async ({ loaded, value }) => {
  const { editor, element } = await mount(loaded ? value : '');
  act(() => { if (!loaded) type(editor, value); editor.commands.setTextSelection(editor.state.doc.content.size - 1); });
  act(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })));
  expect(editor.state.doc.textContent).toBe(value);
  expect(element.querySelector('[data-source-drag]')).toBeNull();
  act(() => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    // jsdom has no native contenteditable delete default action.
    if (editor.state.doc.textContent === value) editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from - 1, editor.state.selection.from));
  });
  expect(editor.state.doc.textContent).toBe(value.slice(0, -1));
  expect(element.querySelector('[data-source-drag]')).toBeNull();
});
