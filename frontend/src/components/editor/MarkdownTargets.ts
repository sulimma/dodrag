import { Node } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { tokenizeTargets } from './targets';

export const plainSources = new PluginKey<{ from: number; to: number }[]>('plainSources');
export const sourceIsPlain = (state: Parameters<typeof plainSources.getState>[0], from: number, to: number) =>
  plainSources.getState(state)?.some(range => from < range.to && to > range.from) ?? false;

// Keep raw targets out of Markdown's escaping, emoji and math tokenizers.
export const MarkdownTargets = Node.create({
  priority: 1100,
  name: 'targetLiteral', group: 'inline', inline: true, content: 'text*', marks: '', code: true,
  parseHTML: () => [{ tag: 'span[data-target-literal]', preserveWhitespace: 'full' }],
  renderHTML: () => ['span', { 'data-target-literal': '' }, 0],
  parseMarkdown: token => ({ type: 'targetLiteral', content: [{ type: 'text', text: token.raw }] }),
  renderMarkdown: node => (node.content ?? []).map(child => child.text ?? '').join(''),
  addProseMirrorPlugins() {
    return [new Plugin<{ from: number; to: number }[]>({
      key: plainSources,
      state: {
        init: () => [],
        apply: (tr, ranges) => [...ranges.map(range => ({ from: tr.mapping.map(range.from, -1), to: tr.mapping.map(range.to, 1) })),
          ...(tr.getMeta(plainSources) ?? [])].filter(range => range.from < range.to),
      },
      props: { handleKeyDown: (view, event) => {
        if (event.key !== 'Backspace' || !view.state.selection.empty) return false;
        const { $from } = view.state.selection;
        let from: number, to: number, text: string;
        if ($from.parent.type.name === this.name) {
          from = $from.before(); to = $from.after(); text = $from.parent.textContent;
        } else {
          const before = $from.nodeBefore;
          if (before?.type.name !== this.name) {
            const token = tokenizeTargets($from.parent.textContent).find(token =>
              token.start < $from.parentOffset && token.end >= $from.parentOffset);
            if (!token) return false;
            const start = $from.start() + token.start, end = $from.start() + token.end;
            if (sourceIsPlain(view.state, start, end)) return false;
            view.dispatch(view.state.tr.setMeta(plainSources, [{ from: start, to: end }]).setMeta('source:refresh', true));
            event.preventDefault(); return true;
          }
          to = $from.pos; from = to - before.nodeSize; text = before.textContent;
        }
        const cursor = $from.parent.type.name === this.name ? from + $from.parentOffset : from + text.length;
        const tr = view.state.tr.replaceWith(from, to, text ? view.state.schema.text(text) : []);
        tr.setSelection(TextSelection.create(tr.doc, cursor));
        tr.setMeta(plainSources, [{ from, to: from + text.length }]);
        view.dispatch(tr); event.preventDefault(); return true;
      } },
    }), new Plugin({ appendTransaction: (transactions, _old, state) => {
      if (!transactions.some(transaction => transaction.docChanged)) return;
      const replacements: { from: number; to: number; text: string }[] = [];
      state.doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.spec.code || node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) return;
        for (const target of tokenizeTargets(node.text ?? '')) {
          if (node.text!.slice(target.start).startsWith('![')) continue;
          const from = pos + target.start, to = pos + target.end;
          if (sourceIsPlain(state, from, to)) continue;
          // ponytail: leave the actively typed source as text until a delimiter;
          // wrapping at its current end would put subsequent input outside it.
          const cursor = state.selection.empty ? state.selection.from : -1;
          const trailing = node.text!.slice(target.end, cursor - pos);
          if (cursor >= from && cursor <= pos + node.nodeSize &&
            (cursor <= to || (/^tel:/i.test(target.value) && /^[\d ()_+\-]*$/.test(trailing)) ||
              (/^(?:mailto|sip|https?):/i.test(target.value) && /^[.]*$/.test(trailing)))) continue;
          replacements.push({ from: pos + target.start, to: pos + target.end, text: node.text!.slice(target.start, target.end) });
        }
      });
      if (!replacements.length) return;
      const tr = state.tr;
      for (const replacement of replacements.reverse()) tr.replaceWith(replacement.from, replacement.to, this.type.create(null, state.schema.text(replacement.text)));
      return tr;
    } })];
  },
  markdownTokenizer: {
    name: 'targetLiteral', level: 'inline',
    start(source) { return tokenizeTargets(source).find(token => !source.slice(token.start).startsWith('!['))?.start ?? -1; },
    tokenize(source) {
      const target = tokenizeTargets(source)[0];
      if (!target || target.start !== 0 || source.startsWith('![')) return;
      return { type: 'targetLiteral', raw: source.slice(0, target.end) };
    },
  },
});
