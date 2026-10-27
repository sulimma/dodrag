import { Extension, InputRule, commands, generateJSON, type JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

export interface SymbolReplacement { shortcut: string; symbol: string; latex?: string }
export const SYMBOL_GROUPS: readonly { labelKey: string; items: readonly SymbolReplacement[] }[] = [
  { labelKey: 'Pfeile', items: [
    { shortcut: '->', symbol: '\u2192' }, { shortcut: '<-', symbol: '\u2190' },
    { shortcut: '<->', symbol: '\u2194' }, { shortcut: '=>', symbol: '\u21d2' }, { shortcut: '<=>', symbol: '\u21d4' },
  ] },
  { labelKey: 'Typografie', items: [{ shortcut: '...', symbol: '\u2026' }, { shortcut: ' -- ', symbol: ' \u2014 ' }] },
  { labelKey: 'Mathematische Zeichen', items: [
    { shortcut: '!=', symbol: '\u2260' }, { shortcut: '<=', symbol: '\u2264' }, { shortcut: '>=', symbol: '\u2265' },
    { shortcut: '~=', symbol: '\u2248' }, { shortcut: '+/-', symbol: '\u00b1' }, { shortcut: ':micro:', symbol: '\u00b5' },
  ] },
  { labelKey: 'Brüche', items: [
    { shortcut: '1/2', symbol: '\u00bd' }, { shortcut: '1/4', symbol: '\u00bc' }, { shortcut: '3/4', symbol: '\u00be' },
    { shortcut: '2/3', symbol: '\u2154', latex: '\\frac{2}{3}' },
  ] },
];

const items = SYMBOL_GROUPS.flatMap(group => group.items).sort((a, b) => b.shortcut.length - a.shortcut.length);
const escapeRE = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scientificPattern = String.raw`[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[eE][+-]?[0-9]+`;
const replacementRE = new RegExp(`${scientificPattern}|${items.filter(item => !item.shortcut.includes('/') || item.shortcut === '+/-').map(item => escapeRE(item.shortcut)).join('|')}|--|[0-9]+/[0-9]+`, 'g');
interface Replacement { from: number; to: number; content: JSONContent }

function replacements(text: string, complete: boolean, typing = false): Replacement[] {
  const result: Replacement[] = [];
  for (const match of text.matchAll(replacementRE)) {
    const from = match.index!;
    const to = from + match[0].length;
    const before = text.slice(0, from);
    const after = text.slice(to);
    const fraction = /^([0-9]+)\/([0-9]+)$/.exec(match[0]);
    const scientific = /^([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))[eE]([+-]?[0-9]+)$/.exec(match[0]);
    if (scientific && (!typing || !/(?:^|[\s([{])$/.test(before) || scientific[1].length > 32 || scientific[2].length > 12)) continue;
    // A word-sized slash/backslash context is a path, URL or chained date, not a fraction.
    const start = before.search(/[^\s]*$/);
    const end = to + (after.search(/\s/) === -1 ? after.length : after.search(/\s/));
    const word = text.slice(start, end);
    const prefix = before.slice(start);
    if (/(?:[a-z][a-z\d+.-]*:\/\/|^[a-z]:|www\.|\\)/i.test(word) ||
      /\//.test(word.replace(match[0], '')) || /[<>=!~+.-]$/.test(prefix) ||
      (before.match(/(?<!\\)\$/g)?.length ?? 0) % 2 || (before.match(/`/g)?.length ?? 0) % 2 ||
      /\[[^\]]*$/.test(before)) continue;
    if (match[0] === '--' && (!/(?:^|\s)$/.test(before) || !/^(?:\s|$)/.test(after))) continue;
    if (fraction && (!/(?:^|[\s([{])$/.test(before) || !/^(?:$|[\s,;!?:)\]}]|\.(?:\s|$))/.test(after))) continue;
    if (!fraction && match[0] !== ' -- ' && !/^(?:$|[\s,;!?:)\]}]|\.(?!\d))/.test(after)) continue;
    if (!complete && !after && match[0] !== ' -- ') continue;
    if (!complete && (fraction || scientific) && after === '.') continue;
    const item = items.find(item => item.shortcut === match[0]);
    if (fraction && (fraction[1].length > 12 || fraction[2].length > 12 || /^0+$/.test(fraction[2]))) continue;
    const latex = scientific ? `${scientific[1]}\\cdot10^{${scientific[2]}}` : fraction && !item ? `\\frac{${fraction[1]}}{${fraction[2]}}` : item?.latex;
    if (latex) result.push({ from, to, content: { type: 'inlineMath', attrs: { latex } } });
    else if (match[0] === '--') result.push({ from, to, content: { type: 'text', text: '\u2014' } });
    else if (item) result.push({ from, to, content: { type: 'text', text: item.symbol } });
  }
  return result;
}

function replaceJSON(node: JSONContent): JSONContent {
  if (['codeBlock', 'targetLiteral', 'inlineMath', 'blockMath'].includes(node.type ?? '') ||
    node.marks?.some(mark => ['code', 'link'].includes(mark.type))) return node;
  if (node.type === 'text') return node;
  const textContent = (node.content ?? []).map(child => child.type === 'text' ? child.text ?? '' : '\ufffc').join('');
  const matches = replacements(textContent, true);
  let start = 0;
  const content = node.content?.flatMap(child => {
    const childStart = start;
    start += child.type === 'text' ? (child.text ?? '').length : 1;
    if (child.type !== 'text' || child.marks?.some(mark => ['code', 'link'].includes(mark.type))) return [replaceJSON(child)];
    const text = child.text ?? '';
    const output: JSONContent[] = [];
    let offset = 0;
    for (const match of matches.filter(match => match.from >= childStart && match.to <= start)) {
      const replacement = { ...match, from: match.from - childStart, to: match.to - childStart };
      if (replacement.from > offset) output.push({ ...child, text: text.slice(offset, replacement.from) });
      output.push({ ...replacement.content, marks: child.marks });
      offset = replacement.to;
    }
    if (offset < text.length) output.push({ ...child, text: text.slice(offset) });
    return output;
  });
  return content ? { ...node, content } : node;
}

// Initial content and setContent deliberately bypass replacement: no old-content migration.
export const SymbolReplacements = Extension.create({
  name: 'symbolReplacements', priority: 90,
  // Keyboard completion precedes StarterKit; import commands must follow Markdown.
  addExtensions() { return [Extension.create({ name: 'symbolEnterCompletion', priority: 110,
  addKeyboardShortcuts() { return { Enter: () => {
    const { state, view } = this.editor;
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size ||
      $from.parent.type.spec.code || [...$from.marks(), ...(state.storedMarks ?? [])].some(mark => ['code', 'link'].includes(mark.type.name))) return false;
    const text = $from.parent.textBetween(0, $from.parentOffset, '\ufffc', '\ufffc');
    const match = replacements(text, true).at(-1);
    if (!match || !/^[.,;!?:)\]}]?$/.test(text.slice(match.to))) return false;
    const from = $from.start() + match.from;
    const to = $from.start() + match.to;
    let protectedText = false;
    state.doc.nodesBetween(from, to, node => { if (node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) protectedText = true; });
    if (!protectedText) view.dispatch(state.tr.replaceWith(from, to, state.schema.nodeFromJSON(match.content).mark(state.doc.resolve(from).marks())));
    // Keep the normal Enter action (paragraph/list split).
    return false;
  } }; },
  })]; },
  addCommands() {
    const imported = (value: unknown, contentType?: string, position?: number) => {
      if (typeof value !== 'string') return value as JSONContent;
      const $from = this.editor.state.doc.resolve(position ?? this.editor.state.selection.from);
      if ($from.parent.type.spec.code || [...$from.marks(), ...(this.editor.state.storedMarks ?? [])].some(mark => ['code', 'link'].includes(mark.type.name))) return value;
      const parsed = contentType === 'markdown' ? this.editor.markdown!.parse(value) : generateJSON(value, this.editor.extensionManager.baseExtensions);
      const before = $from.parent.textBetween(0, $from.parentOffset);
      const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size);
      if (/[^\s([{]$/.test(before) || /^[\p{L}\p{N}_/\\.]/u.test(after)) return parsed;
      return replaceJSON(parsed);
    };
    return {
      insertContent: (value, options) => commands.insertContent(imported(value, options?.contentType), options),
      insertContentAt: (position, value, options) => commands.insertContentAt(position, imported(value, options?.contentType, typeof position === 'number' ? position : position.from), options),
    };
  },
  addInputRules() { return [new InputRule({
    find: text => {
      const match = replacements(text, false, true).at(-1);
      return match && /^[.,;!?:)\]}]?\s?$/.test(text.slice(match.to)) ? { index: match.from, text: text.slice(match.from), data: match } : null;
    },
    handler: ({ state, range, match }) => {
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.spec.code || [...$from.marks(), ...(state.storedMarks ?? [])].some(mark => ['code', 'link'].includes(mark.type.name))) return null;
      const replacement = match.data as Replacement;
      const to = range.from + replacement.to - replacement.from;
      const suffix = $from.parent.textBetween($from.parentOffset + match[0].length, $from.parent.content.size);
      if (/^[/\\\p{L}\p{N}_]/u.test(suffix)) return null;
      let protectedText = false;
      state.doc.nodesBetween(range.from, to, node => { if (node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) protectedText = true; });
      if (protectedText) return null;
      state.tr.replaceWith(range.from, to, state.schema.nodeFromJSON(replacement.content).mark(state.storedMarks ?? $from.marks()));
    },
  })]; },
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPasted: (slice, view) => {
      const { $from } = view.state.selection;
      if ($from.parent.type.spec.code || [...$from.marks(), ...(view.state.storedMarks ?? [])].some(mark => ['code', 'link'].includes(mark.type.name))) return slice;
      const before = $from.parent.textBetween(0, $from.parentOffset);
      const $to = view.state.selection.$to;
      const after = $to.parent.textBetween($to.parentOffset, $to.parent.content.size);
      if (/[^\s([{]$/.test(before) || /^[\p{L}\p{N}_/\\.]/u.test(after)) return slice;
      return new Slice(
        Fragment.fromArray((replaceJSON({ type: 'doc', content: slice.content.toJSON() }).content ?? []).map(node => this.editor.schema.nodeFromJSON(node))),
        slice.openStart, slice.openEnd,
      );
    } } })];
  },
});
