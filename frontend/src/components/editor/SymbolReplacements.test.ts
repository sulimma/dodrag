// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { MarkdownFeatures } from './MarkdownFeatures';
import { MarkdownLink } from './MarkdownLink';
import { MarkdownTargets } from './MarkdownTargets';
import { SYMBOL_GROUPS, SymbolReplacements } from './SymbolReplacements';

const editors: Editor[] = [];
function create(content = '') {
  const editor = new Editor({ extensions: [StarterKit.configure({ link: false, trailingNode: false }), MarkdownLink,
    MarkdownTargets, ...MarkdownFeatures, Markdown, SymbolReplacements], content, contentType: 'markdown' });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    if (!editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)))) {
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }
}
function paste(editor: Editor, source: string, html?: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (format: string) => format === 'text/html' ? html ?? '' : format === 'text/plain' ? source : '' } });
  editor.view.dom.dispatchEvent(event);
}

it('types every advertised shortcut, delays ambiguous prefixes and exports stable Markdown', () => {
  for (const item of SYMBOL_GROUPS.flatMap(group => group.items)) {
    const editor = create(); type(editor, item.shortcut);
    if (item.shortcut !== ' -- ') expect(editor.state.doc.textContent, item.shortcut).toBe(item.shortcut);
    type(editor, ' ');
    if (item.latex) expect(editor.getMarkdown()).toBe(`$${item.latex}$ `);
    else expect(editor.state.doc.textContent, item.shortcut).toBe(`${item.symbol} `);
    expect(create(editor.getMarkdown()).getJSON(), item.shortcut).toEqual(editor.getJSON());
  }
  const long = create(); type(long, '<-> <=> 1/23 123/456 ');
  expect(long.getMarkdown()).toBe('\u2194 \u21d4 $\\frac{1}{23}$ $\\frac{123}{456}$ ');
});

it('imports new Markdown and rich/plain paste with the same symbol and fraction semantics', () => {
  const source = '-> <- <-> => <=> ... a -- b != <= >= ~= +/- :micro: 1/2 1/4 3/4 2/3 1/23';
  const inserted = create(); inserted.commands.insertContent(source, { contentType: 'markdown' });
  expect(inserted.state.doc.textContent).toContain('\u2192 \u2190 \u2194 \u21d2 \u21d4 \u2026 a \u2014 b \u2260 \u2264 \u2265 \u2248 \u00b1 \u00b5 \u00bd \u00bc \u00be ');
  expect(inserted.getMarkdown()).toContain('$\\frac{2}{3}$ $\\frac{1}{23}$');
  const plain = create(); paste(plain, source);
  expect(plain.getJSON()).toEqual(inserted.getJSON());
  const rich = create(); paste(rich, 'fallback', '<p><strong>1/2</strong> 2/3 &lt;-&gt;</p>');
  expect(rich.getMarkdown()).toBe('**\u00bd** $\\frac{2}{3}$ \u2194');
  expect(create(inserted.getMarkdown()).getJSON()).toEqual(inserted.getJSON());
});

it('does not rewrite old content or setContent acknowledgements', () => {
  const source = '<-> 1/2 2/3 :micro:';
  const editor = create(source);
  expect(editor.state.doc.textContent).toBe(source);
  editor.commands.setContent(source, { contentType: 'markdown' });
  expect(editor.state.doc.textContent).toBe(source);
});

it('leaves dates, chained numbers, URLs, paths, decimals and unbounded or zero fractions alone', () => {
  const cases = ['12/34/56', '2026/10/25', '1/2/3', '01/02/2026', '/1/2', 'dir/1/2', '1/2.txt', '1/2.3',
    'https://host.test/1/2', 'https://host.test/?x=->', 'www.host.test/1/2', 'C:\\a\\1/2', 'C:/a/1/2',
    'a1/2', '1/2a', '-1/2', '1/0', '2/00', '1234567890123/2', '1/1234567890123', '-->', '<-->', ':degree:'];
  for (const source of cases) {
    const editor = create(); type(editor, source + ' ');
    expect(editor.state.doc.textContent, `typed ${source}`).toBe(source + ' ');
    const imported = create(); imported.commands.insertContent(source, { contentType: 'markdown' });
    expect(imported.view.dom.querySelector('[data-type=inline-math]'), `imported ${source}`).toBeNull();
    expect(imported.state.doc.textContent, `imported ${source}`).toBe(source);
  }
});

it('protects code, Mermaid, math and link text on input and paste', () => {
  const editor = create(); editor.commands.insertContent('`1/2 ->`\n\n```mermaid\nA --> B\n```\n\n[1/2 ->](https://host.test)\n\n$1/2 + 2/3$', { contentType: 'markdown' });
  expect(editor.state.doc.textContent).toContain('1/2 ->');
  expect(editor.view.dom.querySelectorAll('[data-type=inline-math]')).toHaveLength(1);
  const code = create(); code.commands.toggleCode(); type(code, '1/2 -> ');
  expect(code.state.doc.textContent).toBe('1/2 -> ');
  const link = create('[start end](https://host.test)'); link.commands.setTextSelection(7); type(link, '1/2 -> ');
  expect(link.state.doc.textContent).toBe('start 1/2 -> end');
  const math = create(); type(math, '$1/2 + 2/3$ ');
  expect(math.getMarkdown()).toBe('$1/2 + 2/3$ ');
  const rich = create(); paste(rich, '', '<p><code>1/2 -&gt;</code> <a href="https://host.test">1/2 -&gt;</a></p><pre><code class="language-mermaid">A --&gt; B</code></pre>');
  expect(rich.state.doc.textContent).toContain('1/2 ->');
  expect(rich.view.dom.querySelector('[data-type=inline-math]')).toBeNull();
});

it('checks rich text boundaries and protects paste destinations and mid-text input', () => {
  const rich = create(); paste(rich, '', '<p><strong>1/2</strong>/3 <strong>1/2</strong>.txt <em>dir/</em>1/2</p>');
  expect(rich.state.doc.textContent).toBe('1/2/3 1/2.txt dir/1/2');
  expect(rich.view.dom.querySelector('[data-type=inline-math]')).toBeNull();
  const code = create(); code.commands.toggleCodeBlock(); paste(code, '1/2 ->');
  expect(code.state.doc.textContent).toBe('1/2 ->');
  const link = create('[start end](https://host.test)'); link.commands.setTextSelection(7); paste(link, '1/2 ->');
  expect(link.state.doc.textContent).toBe('start 1/2 ->end');
  const middle = create('1/2/3'); middle.commands.setTextSelection(4); type(middle, ' ');
  expect(middle.state.doc.textContent).toBe('1/2 /3');
  const path = create('dir/'); path.commands.setTextSelection(5); paste(path, '1/2');
  expect(path.state.doc.textContent).toBe('dir/1/2');
  const date = create('/56'); date.commands.setTextSelection(1); paste(date, '12/34');
  expect(date.state.doc.textContent).toBe('12/34/56');
  const inserted = create('dir/'); inserted.commands.setTextSelection(5); inserted.commands.insertContent('1/2', { contentType: 'markdown' });
  expect(inserted.state.doc.textContent).toBe('dir/1/2');
});

it('keeps delimiters, formatting and caret after conversion and accepts safe punctuation', () => {
  const editor = create(); editor.commands.toggleBold(); type(editor, '1/23 ');
  expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  type(editor, 'next');
  expect(editor.getMarkdown()).toContain('$\\frac{1}{23}$ **next**');
  const punctuation = create(); type(punctuation, '1/2. ');
  expect(punctuation.state.doc.textContent).toBe('\u00bd. ');
});

it('reverts text and math input rules with Backspace and undo without immediately reapplying them', () => {
  for (const source of ['<-> ', '1/2 ', '2/3 ', 'a -- ', '3e-9 ']) {
    const editor = create(); type(editor, source);
    expect(editor.state.doc.textContent).not.toBe(source);
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, event));
    expect(editor.state.doc.textContent, source).toBe(source);
    editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from - 1, editor.state.selection.from));
    type(editor, ' ');
    expect(editor.state.doc.textContent).not.toBe(source);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent, source).toBe(source);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.state.doc.textContent).not.toBe(source);
  }
  const pasted = create(); paste(pasted, '2/3 <->');
  expect(pasted.commands.undo()).toBe(true);
  expect(pasted.state.doc.textContent).toBe('');
});

it('converts scientific notation only when typed and preserves the exact input on Backspace', () => {
  for (const [source, latex] of [['3e-9', '3\\cdot10^{-9}'], ['-1.25E+12', '-1.25\\cdot10^{+12}'], ['.5e03', '.5\\cdot10^{03}']]) {
    const editor = create(); type(editor, source);
    expect(editor.state.doc.textContent).toBe(source);
    type(editor, ' ');
    expect(editor.getMarkdown()).toBe(`$${latex}$ `);
    editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })));
    expect(editor.state.doc.textContent).toBe(source + ' ');
    expect(create(source).state.doc.textContent).toBe(source);
    const imported = create(); imported.commands.insertContent(source, { contentType: 'markdown' });
    expect(imported.state.doc.textContent).toBe(source);
    const pasted = create(); paste(pasted, source);
    expect(pasted.state.doc.textContent).toBe(source);
    const rich = create(); paste(rich, '', `<p>${source}</p>`);
    expect(rich.state.doc.textContent).toBe(source);
  }
  for (const source of ['a3e-9', '3e-9a', '3e', '3e-', '3e-9.5', 'dir/3e-9', 'https://host.test/3e-9', '$3e-9']) {
    const editor = create(); type(editor, source + ' ');
    expect(editor.state.doc.textContent, source).toBe(source + ' ');
  }
  const code = create(); code.commands.toggleCode(); type(code, '3e-9 ');
  expect(code.state.doc.textContent).toBe('3e-9 ');
});
