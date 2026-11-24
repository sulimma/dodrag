import { Node } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { classifyTarget, tokenizeTargets } from './targets';

// Bare sources contain their destination as editable text. URL punctuation
// that would be treated as prose by the tokenizer can use Markdown autolinks.
export const MarkdownTargets = Node.create({
  priority: 1100,
  name: 'targetLiteral', group: 'inline', inline: true, content: 'text*', marks: '', code: true,
  parseHTML: () => [{ tag: 'span[data-target-literal]', preserveWhitespace: 'full' }],
  renderHTML: () => ['span', { 'data-target-literal': '' }, 0],
  parseMarkdown: token => ({ type: 'targetLiteral', content: [{ type: 'text', text: token.raw }] }),
  renderMarkdown: node => {
    const text = (node.content ?? []).map(child => child.text ?? '').join('');
    const target = classifyTarget(text);
    if (target?.kind === 'url' && text === target.value &&
        !tokenizeTargets(text).some(token => token.start === 0 && token.end === text.length)) return '<' + text + '>';
    return text;
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleKeyDown: (view, event) => {
          const backwards = event.key === 'Backspace';
          if ((!backwards && event.key !== 'Delete') || event.shiftKey || event.ctrlKey ||
              event.altKey || event.metaKey) return false;
          const { doc, selection } = view.state;
          const native = view.hasFocus() ? view.dom.ownerDocument.getSelection() : null;
          const focus = native?.focusNode;
          const nativeInEditor = !!focus && view.dom.contains(focus);
          if (nativeInEditor ? !native!.isCollapsed : !selection.empty) return false;

          // Chromium can move the DOM caret before ProseMirror processes selectionchange.
          const $caret = nativeInEditor ? doc.resolve(view.posAtDOM(focus!, native!.focusOffset)) : selection.$from;
          const insideSource = $caret.parent.type === this.type;
          const source = insideSource ? $caret.parent : backwards ? $caret.nodeBefore : $caret.nodeAfter;
          if (source?.type !== this.type) return false;
          const text = source.textContent;
          const offset = insideSource ? $caret.parentOffset : backwards ? text.length : 0;
          const removed = backwards ? Array.from(text.slice(0, offset)).at(-1) : Array.from(text.slice(offset))[0];
          if (!removed) return false;
          const boundary = insideSource ? $caret.pos : $caret.pos + (backwards ? -1 : 1);
          const from = backwards ? boundary - removed.length : boundary;
          const to = backwards ? boundary : boundary + removed.length;
          const tr = view.state.tr.delete(from, to);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from)).scrollIntoView());
          event.preventDefault();
          return true;
        },
      },
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some(transaction => transaction.docChanged)) return;
        const replacements: { from: number; to: number; text: string }[] = [];
        state.doc.descendants((node, pos, parent) => {
          if (!node.isText || parent?.type.spec.code || node.marks.some(mark => ['code', 'link'].includes(mark.type.name))) return;
          for (const target of tokenizeTargets(node.text ?? '')) {
            if (node.text!.slice(target.start).startsWith('![')) continue;
            const from = pos + target.start, to = pos + target.end;
            // Leave the growing source as text until a delimiter. Wrapping
            // it at the cursor would put the next keystroke outside it.
            const cursor = state.selection.empty ? state.selection.from : -1;
            const trailing = node.text!.slice(target.end, cursor - pos);
            if (cursor >= from && cursor <= pos + node.nodeSize &&
                (cursor <= to || (/^tel:/i.test(target.value) && /^[\d ()_+\-]*$/.test(trailing)) ||
                  (/^(?:mailto|sip|https?):/i.test(target.value) && /^[.]*$/.test(trailing)))) continue;
            replacements.push({ from, to, text: node.text!.slice(target.start, target.end) });
          }
        });
        if (!replacements.length) return;
        const tr = state.tr;
        for (const { from, to, text } of replacements.reverse()) {
          tr.replaceWith(from, to, this.type.create(null, state.schema.text(text)));
        }
        return tr;
      },
    })];
  },
  markdownTokenizer: {
    name: 'targetLiteral', level: 'inline',
    start(source) {
      // Marked omits the preceding character from this lookahead. A leading
      // slash here may be inside a word or fraction. tokenize() handles real
      // token boundaries, including paths at the beginning of a paragraph.
      return tokenizeTargets(source).find(token =>
        !(token.start === 0 && source.startsWith('/')) && !source.slice(token.start).startsWith('![')
      )?.start ?? -1;
    },
    tokenize(source) {
      const target = tokenizeTargets(source)[0];
      if (!target || target.start !== 0 || source.startsWith('![')) return;
      return { type: 'targetLiteral', raw: source.slice(0, target.end) };
    },
  },
});
