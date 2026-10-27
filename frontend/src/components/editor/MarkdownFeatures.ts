import { Node, InputRule, type Extensions } from '@tiptap/core';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AlertView } from './AlertView';
import { mathNodeView } from './MathNodeView';
import 'katex/dist/katex.min.css';

export const ALERT_TYPES = [
  { type: 'NOTE', labelKey: 'Note', icon: '\u2139\ufe0f' },
  { type: 'IMPORTANT', labelKey: 'Important', icon: '\u2757' },
  { type: 'WARNING', labelKey: 'Warning', icon: '\u26a0\ufe0f' },
  { type: 'TIP', labelKey: 'Tip', icon: '\ud83d\udca1' },
  { type: 'CAUTION', labelKey: 'Caution', icon: '\u26d4' },
] as const;

export interface EmoticonItem { shortcut: string; emoji: string; color?: string }

const shapeColors = [
  { labelKey: 'Rot', suffix: 'r', color: '#dc2626', circle: '\ud83d\udd34', square: '\ud83d\udfe5' },
  { labelKey: 'Orange', suffix: 'o', color: '#ea580c', circle: '\ud83d\udfe0', square: '\ud83d\udfe7' },
  { labelKey: 'Gelb', suffix: 'y', color: '#eab308', circle: '\ud83d\udfe1', square: '\ud83d\udfe8' },
  { labelKey: 'Grün', suffix: 'g', color: '#16a34a', circle: '\ud83d\udfe2', square: '\ud83d\udfe9' },
  { labelKey: 'Blau', suffix: 'b', color: '#2563eb', circle: '\ud83d\udd35', square: '\ud83d\udfe6' },
  { labelKey: 'Violett', suffix: 'v', color: '#9333ea', circle: '\ud83d\udfe3', square: '\ud83d\udfea' },
  { labelKey: 'Braun', suffix: 'br', color: '#92400e', circle: '\ud83d\udfe4', square: '\ud83d\udfeb' },
  { labelKey: 'Schwarz', suffix: 'k', color: '#000000', circle: '\u26ab', square: '\u2b1b' },
  { labelKey: 'Weiß', suffix: 'w', color: '#ffffff', circle: '\u26aa', square: '\u2b1c' },
] as const;

// Only yellow has a star emoji. Other star colors use the existing text star + CSS.
export const EMOTICON_SHAPE_VARIANTS: Readonly<Record<'star' | 'circle' | 'square', readonly (EmoticonItem & { labelKey: string })[]>> = {
  star: shapeColors.map(item => ({ labelKey: item.labelKey, shortcut: item.suffix === 'y' ? '(*)' : `(*${item.suffix})`,
    emoji: item.suffix === 'y' ? '\u2b50' : '\u2605', ...(item.suffix === 'y' ? {} : { color: item.color }) })),
  circle: shapeColors.map(item => ({ labelKey: item.labelKey,
    shortcut: ['r', 'y', 'g', 'b'].includes(item.suffix) ? `(${item.suffix})` : `(circle:${item.suffix})`, emoji: item.circle })),
  square: shapeColors.map(item => ({ labelKey: item.labelKey, shortcut: `[${item.suffix}]`, emoji: item.square })),
};

export const EMOTICONS: readonly { shortcut: string; emoji: string; color?: string }[] = [
  { shortcut: ':)', emoji: '\ud83d\ude42' }, { shortcut: ':(', emoji: '\ud83d\ude41' },
  { shortcut: ':P', emoji: '\ud83d\ude1b' }, { shortcut: ':D', emoji: '\ud83d\ude03' },
  { shortcut: ';)', emoji: '\ud83d\ude09' }, { shortcut: '(Y)', emoji: '\ud83d\udc4d' },
  { shortcut: '(N)', emoji: '\ud83d\udc4e' }, { shortcut: '(on)', emoji: '\ud83d\udca1' },
  { shortcut: '(off)', emoji: '\ud83d\udca1', color: 'gray' }, { shortcut: '(!)', emoji: '\u26a0\ufe0f' },
  { shortcut: '(*)', emoji: '\u2b50' }, { shortcut: '(*r)', emoji: '\u2605', color: '#dc2626' },
  { shortcut: '(*g)', emoji: '\u2605', color: '#16a34a' }, { shortcut: '(*b)', emoji: '\u2605', color: '#2563eb' },
  { shortcut: '(*y)', emoji: '\u2b50' }, { shortcut: '(/)', emoji: '\u2705' },
  { shortcut: '(x)', emoji: '\u274c' }, { shortcut: '(i)', emoji: '\u2139\ufe0f' },
  { shortcut: '(+)', emoji: '\u2795', color: '#16a34a' }, { shortcut: '(-)', emoji: '\u26d4' },
  { shortcut: '(?)', emoji: '\u2753' }, { shortcut: '<3', emoji: '\u2764\ufe0f' },
  { shortcut: '</3', emoji: '\ud83d\udc94' },
  { shortcut: '(c)', emoji: '\u00a9' }, { shortcut: '(R)', emoji: '\u00ae' },
  { shortcut: '(TM)', emoji: '\u2122' },
  { shortcut: '["]', emoji: '\u23f8\ufe0f' }, { shortcut: '[>]', emoji: '\u25b6\ufe0f' },
  { shortcut: '[<>]', emoji: '\ud83d\udd04' }, { shortcut: '(><)', emoji: '\u23f3' },
  { shortcut: '[0]', emoji: '\u23f9\ufe0f' }, { shortcut: '(#)', emoji: '\ud83d\udea8' },
  { shortcut: '(f)', emoji: '\ud83d\udd25' }, { shortcut: '(s)', emoji: '\u26a1' },
  { shortcut: '(|)', emoji: '\ud83d\udccc' }, { shortcut: '(t)', emoji: '\ud83d\udd16' },
  { shortcut: '(p)', emoji: '\ud83d\udd0d' }, { shortcut: '(h)', emoji: '\ud83d\udee0\ufe0f' },
  { shortcut: '(~)', emoji: '\ud83d\udcac' }, { shortcut: '(_)', emoji: '\ud83d\udcdd' },
  { shortcut: '(1)', emoji: '\ud83d\udc64' }, { shortcut: '(2)', emoji: '\ud83d\udc65' },
  { shortcut: '(q)', emoji: '\ud83d\ude4b' }, { shortcut: '(M)', emoji: '\u2696\ufe0f' },
  { shortcut: '(Z)', emoji: '\ud83d\udcdc' },
  ...EMOTICON_SHAPE_VARIANTS.star.filter(item => !['(*)', '(*r)', '(*g)', '(*b)'].includes(item.shortcut)),
  ...EMOTICON_SHAPE_VARIANTS.circle, ...EMOTICON_SHAPE_VARIANTS.square,
];

const emoticonItems = (...shortcuts: string[]) => shortcuts.map(shortcut => EMOTICONS.find(item => item.shortcut === shortcut)!);
export const EMOTICON_GROUPS: readonly { labelKey: string; items: readonly EmoticonItem[] }[] = [
  { labelKey: 'Emotion-Shortcuts', items: emoticonItems(':)', ':(', ':P', ':D', ';)', '(Y)', '(N)', '<3', '</3') },
  { labelKey: 'Farben', items: ['star', 'circle', 'square'].flatMap(shape =>
    ['Rot', 'Gelb', 'Grün', 'Blau'].map(labelKey => EMOTICON_SHAPE_VARIANTS[shape as keyof typeof EMOTICON_SHAPE_VARIANTS].find(item => item.labelKey === labelKey)!)) },
  { labelKey: 'Statussymbole', items: emoticonItems('(/)', '(x)', '(i)', '(!)', '(+)', '(-)', '(?)', '(on)', '(off)', '["]', '[>]', '[<>]', '(><)', '[0]', '(#)', '(f)', '(s)') },
  { labelKey: 'Arbeitssymbole', items: emoticonItems('(|)', '(t)', '(p)', '(h)', '(~)', '(_)', '(M)', '(Z)') },
  { labelKey: 'Personen', items: emoticonItems('(1)', '(2)', '(q)') },
  { labelKey: 'Typografie', items: emoticonItems('(c)', '(R)', '(TM)') },
];

const escapeRE = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortcuts = EMOTICONS.map(item => escapeRE(item.shortcut)).join('|');
const shortcutRE = new RegExp(`(^|[^\\p{L}\\p{N}_])(${shortcuts})(?![\\p{L}\\p{N}_])`, 'gu');
const typingRE = new RegExp(`(^|[^\\p{L}\\p{N}_])(${shortcuts})$`, 'u');
const urlRE = /(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>]+/gi;
const inURL = (text: string, start: number) => Array.from(text.matchAll(urlRE)).some(match => start >= match.index! && start < match.index! + match[0].length);
const inUnclosedMath = (text: string) => (text.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1 || /^\$\$/.test(text);

export const Emoticon = Node.create({
  name: 'emoticon', inline: true, group: 'inline', atom: true,
  addAttributes() { return { shortcut: { default: ':)' } }; },
  parseHTML() { return [{ tag: 'span[data-emoticon]', getAttrs: element => {
    const shortcut = (element as HTMLElement).dataset.emoticon;
    return EMOTICONS.some(item => item.shortcut === shortcut) ? { shortcut } : false;
  } }]; },
  renderHTML({ node }) {
    const item = EMOTICONS.find(item => item.shortcut === node.attrs.shortcut)!;
    return ['span', { 'data-emoticon': item.shortcut, style: item.color === 'gray' ? 'filter:grayscale(1);opacity:.55' : item.color ? `color:${item.color}${item.color === '#ffffff' ? ';-webkit-text-stroke:1px #64748b' : ''}` : undefined }, item.emoji];
  },
  addInputRules() { return [new InputRule({ find: typingRE, handler: ({ state, range, match }) => {
    const from = range.from + match[1].length;
    const $from = state.doc.resolve(from);
    if ($from.parent.type.spec.code || $from.marks().some(mark => ['code', 'link'].includes(mark.type.name)) ||
      inURL($from.parent.textContent + match[2].slice(-1), $from.parentOffset) ||
      inUnclosedMath($from.parent.textBetween(0, $from.parentOffset))) return null;
    state.tr.replaceWith(from, range.to, this.type.create({ shortcut: match[2] }));
  } })]; },
  parseMarkdown: token => ({ type: 'emoticon', attrs: { shortcut: token.shortcut } }),
  renderMarkdown: node => node.attrs?.shortcut ?? '',
  markdownTokenizer: {
    name: 'emoticon', level: 'inline',
    start: source => { shortcutRE.lastIndex = 0; const match = shortcutRE.exec(source); return match ? match.index + match[1].length : -1; },
    tokenize(source, tokens) {
      const previous = tokens.at(-1)?.raw ?? '';
      if (/[\p{L}\p{N}_]$/u.test(previous)) return;
      const item = EMOTICONS.find(item => source.startsWith(item.shortcut) && !/^[\p{L}\p{N}_]/u.test(source.slice(item.shortcut.length)));
      if (item) return { type: 'emoticon', raw: item.shortcut, shortcut: item.shortcut };
    },
  },
});

export const Alert = Node.create({
  name: 'alert', priority: 110, group: 'block', content: 'block+', defining: true,
  addAttributes() { return { type: { default: 'NOTE' } }; },
  parseHTML() { return [{ tag: 'div[data-alert]', contentElement: '[data-alert-content]', getAttrs: element => {
    const type = (element as HTMLElement).dataset.alert;
    return ALERT_TYPES.some(item => item.type === type) ? { type } : false;
  } }]; },
  renderHTML({ node }) { return ['div', { 'data-alert': node.attrs.type }, ['div', { 'data-alert-content': '' }, 0]]; },
  addNodeView() { return ReactNodeViewRenderer(AlertView); },
  addKeyboardShortcuts() { return { Enter: () => {
    const { $from, empty } = this.editor.state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size ||
      [...$from.marks(), ...(this.editor.state.storedMarks ?? [])].some(mark => ['code', 'link'].includes(mark.type.name))) return false;
    const match = /^(?:> )?\[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\][ \t]*$/.exec($from.parent.textContent);
    if (!match) return false;
    const commands = this.editor.chain().deleteRange({ from: $from.start(), to: $from.end() });
    if ($from.depth > 1 && $from.node($from.depth - 1).type.name === 'blockquote') commands.lift('blockquote');
    return commands.wrapIn(this.name, { type: match[1] }).run();
  } }; },
  addInputRules() { return ALERT_TYPES.map(item => new InputRule({
    find: new RegExp(`^(?:> )?\\[!${item.type}\\]\\s$`),
    handler: ({ state, range, chain }) => {
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.spec.code) return null;
      const commands = chain().deleteRange(range);
      if ($from.depth > 1 && $from.node($from.depth - 1).type.name === 'blockquote') commands.lift('blockquote');
      commands.wrapIn(this.name, { type: item.type }).run();
    },
  })); },
  parseMarkdown(token, helpers) {
    const content = helpers.parseChildren(token.tokens ?? []);
    return { type: 'alert', attrs: { type: token.alertType }, content: content.length ? content : [{ type: 'paragraph' }] };
  },
  renderMarkdown: (node, helpers) => `[!${node.attrs?.type}]\n${helpers.renderChildren(node.content ?? [], '\n\n')}`.split('\n').map(line => `> ${line}`).join('\n'),
  markdownTokenizer: {
    name: 'alert', level: 'block', start: source => source.search(/^ {0,3}> \[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]/m),
    tokenize(source, _tokens, lexer) {
      const match = /^ {0,3}> \[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\][ \t]*(?:\n|$)/.exec(source);
      if (!match) return;
      const body = /^(?: {0,3}>[^\n]*(?:\n|$))*/.exec(source.slice(match[0].length))![0];
      return { type: 'alert', raw: match[0] + body, alertType: match[1], tokens: lexer.blockTokens(body.replace(/^ {0,3}> ?/gm, '')) };
    },
  },
});

function mathNode(block: boolean) {
  const name = block ? 'blockMath' : 'inlineMath';
  return (block ? BlockMath : InlineMath).extend({
    addNodeView() { return mathNodeView(block, this.options.katexOptions); },
    addInputRules() { return [new InputRule({ find: block ? /^\$\$((?:\\.|[^$])+)\$\$$/ : /(?:^|[^$\\])(\$(?:\\.|[^$\n])+\$)$/, handler: ({ state, range, match }) => {
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.spec.code || $from.marks().some(mark => ['code', 'link'].includes(mark.type.name)) || inURL($from.parent.textContent, $from.parentOffset)) return null;
      const source = block ? match[0] : match[1];
      if (block) state.tr.replaceWith($from.before(), $from.after(), this.type.create({ latex: source.slice(2, -2) }));
      else state.tr.replaceWith(range.to - source.length, range.to, this.type.create({ latex: source.slice(1, -1) }));
    } })]; },
    parseMarkdown: token => ({ type: name, attrs: { latex: token.latex } }),
    renderMarkdown: node => block ? `$$${node.attrs?.latex ?? ''}$$` : node.attrs?.latex ? `$${node.attrs.latex}$` : '<span data-type="inline-math" data-latex=""></span>',
    markdownTokenizer: {
      name, level: block ? 'block' : 'inline', start: source => source.indexOf(block ? '$$' : '$'),
      tokenize(source, tokens) {
        if (!block && /[$\\]$/.test(tokens.at(-1)?.raw ?? '')) return;
        const match = (block ? /^\$\$((?:\\.|[^$]|\$(?!\$))*)\$\$(?:[ \t]*\n|$)/ : /^\$((?:\\.|[^$\n])+)\$(?!\$)/).exec(source);
        if (match) return { type: name, raw: match[0], latex: match[1] };
      },
    },
  });
}

export const MarkdownMathBlock = mathNode(true);
export const MarkdownMathInline = mathNode(false);
const safeKatexOptions = { trust: false, throwOnError: false, strict: 'ignore' as const, maxExpand: 1000, maxSize: 20 };
export const MarkdownFeatures: Extensions = [Alert, MarkdownMathBlock.configure({ katexOptions: { ...safeKatexOptions, displayMode: true } }), MarkdownMathInline.configure({ katexOptions: safeKatexOptions }), Emoticon];

export const markdownFeaturesCSS = `.dodrag-description [data-alert]{border-left:3px solid #2563eb;background:#eff6ff;padding:.5em .75em;margin:.5em 0}.dodrag-description [data-alert=TIP]{border-color:#16a34a;background:#f0fdf4}.dodrag-description [data-alert=IMPORTANT]{border-color:#9333ea;background:#faf5ff}.dodrag-description [data-alert=WARNING]{border-color:#ca8a04;background:#fefce8}.dodrag-description [data-alert=CAUTION]{border-color:#dc2626;background:#fef2f2}.dodrag-description .alert-title{font-weight:600;display:flex;gap:.5em}.dodrag-description .tiptap-mathematics-render{cursor:text}.dodrag-description .tiptap-mathematics-render textarea{min-width:12em;max-width:100%;padding:.25em;font-family:monospace;border:1px solid #94a3b8;background:white}.dodrag-description .katex-display{margin:.5em 0}`;
