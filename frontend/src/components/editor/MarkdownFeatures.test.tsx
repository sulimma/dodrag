// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { getLanguage, setLanguage, t } from '../../i18n';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownLink } from './MarkdownLink';
import { Markdown } from '@tiptap/markdown';
import { MarkdownTargets } from './MarkdownTargets';
import { ALERT_TYPES, EMOTICONS, MarkdownFeatures } from './MarkdownFeatures';

const editors: Editor[] = [];
function create(content = '') {
  const editor = new Editor({ extensions: [StarterKit.configure({ link: false, trailingNode: false }), MarkdownLink.configure({ openOnClick: false }), ...MarkdownFeatures, MarkdownTargets,
    Markdown], content, contentType: 'markdown' });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const markdown = (editor: Editor): string => editor.getMarkdown();
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

it('roundtrips every supplied Confluence shortcut and renders Unicode without image assets', () => {
  const source = EMOTICONS.map(item => item.shortcut).join(' ');
  const editor = create(source);
  expect(editor.view.dom.querySelectorAll('[data-emoticon]')).toHaveLength(23);
  expect(editor.view.dom.querySelectorAll('img[src]')).toHaveLength(0);
  expect(markdown(editor)).toBe(source);
  expect(create(markdown(editor)).getJSON()).toEqual(editor.getJSON());
  expect(editor.view.dom.querySelector('[data-emoticon="(off)"]')?.getAttribute('style')).toContain('grayscale');
  for (const item of EMOTICONS) {
    const typed = create(); type(typed, item.shortcut);
    expect(typed.state.doc.firstChild?.firstChild?.type.name, item.shortcut).toBe('emoticon');
    expect(markdown(typed)).toBe(item.shortcut);
  }
});

it('does not substitute shortcuts in code, links, bare URLs or LaTeX', () => {
  const editor = create('`:D (*)`\n\n```text\n:D (*)\n```\n\n[http :D](https://example.org/:D) https://example.org/:D\n\n$\\text{:D (*)} + \\alpha$\n\n$$\n\\text{:D} + \\beta\n$$');
  expect(editor.view.dom.querySelector('[data-emoticon]')).toBeNull();
  expect(markdown(editor)).toContain('$\\text{:D (*)} + \\alpha$');
  expect(markdown(editor)).toContain('$$\n\\text{:D} + \\beta\n$$');
  for (const source of ['https://example.org/:D', 'www.example.org/:D']) {
    const typed = create(); type(typed, source);
    expect(typed.view.dom.querySelector('[data-emoticon]')).toBeNull();
  }
  const code = create(); code.commands.toggleCode(); type(code, ':D');
  expect(code.view.dom.querySelector('[data-emoticon]')).toBeNull();
});

it('imports GitHub alerts with formatted multiline content and preserves ordinary blockquotes', () => {
  for (const item of ALERT_TYPES) {
    const editor = create(`> [!${item.type}]\n> **Heading**\n>\n> second\n>\n> - entry`);
    expect(editor.state.doc.firstChild?.type.name).toBe('alert');
    expect(editor.state.doc.firstChild?.attrs.type).toBe(item.type);
    expect(editor.state.doc.firstChild?.childCount).toBe(3);
    expect(markdown(editor)).toContain(`> [!${item.type}]`);
    expect(create(markdown(editor)).getJSON()).toEqual(editor.getJSON());
    const typed = create(); type(typed, `> [!${item.type}] `);
    expect(typed.state.doc.firstChild?.type.name).toBe('alert');
  }
  expect(create('> ordinary\n> [!NOTE] not first').state.doc.firstChild?.type.name).toBe('blockquote');
  expect(create('> [!UNKNOWN]\n> text').state.doc.firstChild?.type.name).toBe('blockquote');
  const empty = create('> [!NOTE]');
  expect(empty.state.doc.firstChild?.firstChild?.type.name).toBe('paragraph');
  expect(create(markdown(empty)).getJSON()).toEqual(empty.getJSON());
});

it('inserts Markdown features and preserves rich HTML nodes', () => {
  const editor = create();
  editor.commands.insertContent('> [!TIP]\n> :D $\\alpha$', { contentType: 'markdown' });
  expect(editor.state.doc.firstChild?.type.name).toBe('alert');
  expect(markdown(editor)).toContain(':D $\\alpha$');
  expect(create(editor.getHTML()).getJSON()).toEqual(editor.getJSON());
});

it('renders safe inline and block KaTeX while retaining editable exact LaTeX', () => {
  const source = '$\\frac{a}{b}$\n\n$$\n\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}\n$$';
  const editor = create(source);
  expect(editor.view.dom.querySelector('.katex-display')).not.toBeNull();
  expect(editor.view.dom.querySelector('.katex')).not.toBeNull();
  expect(markdown(editor)).toBe(source);
  expect(create(markdown(editor)).getJSON()).toEqual(editor.getJSON());
  const unsafe = create('$\\href{javascript:alert(1)}{bad}$');
  expect(unsafe.view.dom.querySelector('a[href]')).toBeNull();
  for (const input of ['$x^2$', '$$x^2$$']) {
    const typed = create(); type(typed, input);
    expect(typed.state.doc.firstChild?.type.name).toBe(input.startsWith('$$') ? 'blockMath' : 'paragraph');
    expect(markdown(typed)).toBe(input);
  }
});

it('edits math with exact spaces, escaped dollars and multiline LaTeX without replacing emoticons', () => {
  const source = '$  \\text{a \\$ :D}  $\n\n$$\n  x &= 1 \\\\ \n  y &= 2\n$$';
  const editor = create(source);
  document.body.append(editor.view.dom);
  const language = getLanguage();
  try {
    expect(markdown(editor)).toBe(source);
    const inline = editor.view.dom.querySelector<HTMLElement>('[data-type=inline-math]')!;
    const preview = inline.querySelector<HTMLElement>('[role=button]')!;
    expect(preview.tabIndex).toBe(0);
    preview.focus();
    preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const input = inline.querySelector('textarea')!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe(t('Formel'));
    input.value = '  \\alpha + \\text{:D}  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(markdown(editor)).toContain('$  \\alpha + \\text{:D}  $');
    expect(editor.view.dom.querySelector('[data-emoticon]')).toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(input.hidden).toBe(true);
    setLanguage('en'); editor.view.dispatch(editor.state.tr); inline.click();
    expect(input.getAttribute('aria-label')).toBe(t('Formel'));
    expect(create(markdown(editor)).getJSON()).toEqual(editor.getJSON());
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(create(markdown(editor)).getJSON()).toEqual(editor.getJSON());
    input.blur(); editor.setEditable(false); inline.click();
    expect(input.hidden).toBe(true);
  } finally { setLanguage(language); editor.view.dom.remove(); }
  const typed = create(); type(typed, '$\\text{:D} + x$');
  expect(typed.view.dom.querySelector('[data-emoticon]')).toBeNull();
  expect(markdown(typed)).toBe('$\\text{:D} + x$');
});
