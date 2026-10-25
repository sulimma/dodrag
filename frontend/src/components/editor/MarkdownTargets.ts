import { Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { tokenizeTargets } from './targets';

// Keep raw targets out of Markdown's escaping, emoji and math tokenizers.
export const MarkdownTargets = Node.create({
  name: 'targetLiteral', group: 'inline', inline: true, content: 'text*', marks: '', code: true,
  parseHTML: () => [{ tag: 'span[data-target-literal]', preserveWhitespace: 'full' }],
  renderHTML: () => ['span', { 'data-target-literal': '' }, 0],
  parseMarkdown: token => ({ type: 'targetLiteral', content: [{ type: 'text', text: token.raw }] }),
  renderMarkdown: node => (node.content ?? []).map(child => child.text ?? '').join(''),
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction: (transactions, _old, state) => {
      if (!transactions.some(transaction => transaction.docChanged)) return;
      const replacements: { from: number; to: number; text: string }[] = [];
      state.doc.descendants((node, pos, parent) => {
        if (!node.isText || parent?.type.spec.code || node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) return;
        for (const target of tokenizeTargets(node.text ?? '')) {
          if (node.text!.slice(target.start).startsWith('![')) continue;
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
