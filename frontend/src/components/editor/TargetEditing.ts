import { Extension, getMarkRange } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { SourceRange } from './PathAndUrlExtension';
import { t } from '../../i18n';
import { getDomainWithoutSuffix } from 'tldts';
import { classifyTarget, fileDropText } from './targets';

const editing = new PluginKey<DecorationSet>('targetEditing');

export function targetEditLabel(target: SourceRange['target']): string {
  if (target.kind === 'path') return t('Pfad bearbeiten');
  if (/^(tel|sip):/i.test(target.value)) return t('Telefonnummer bearbeiten');
  if (/^mailto:/i.test(target.value)) return t('E-Mail-Adresse bearbeiten');
  return t('URL bearbeiten');
}

export function targetAsLabel(range: SourceRange): string {
  if (range.target.kind === 'path') return t('Pfad als Linktext');
  if (/^(tel|sip):/i.test(range.target.value)) return t('Telefonnummer als Linktext');
  if (/^mailto:/i.test(range.target.value)) return t('E-Mail-Adresse als Linktext');
  return t('URL als Linktext');
}

function defaultLinkLabel(target: SourceRange['target']): string {
  if (target.kind === 'path') {
    const name = target.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? target.value;
    return t('Verzeichnis {name}', { name });
  }
  const url = new URL(target.value);
  if (url.protocol === 'tel:') {
    return t('Telefon ...{digits}', { digits: url.pathname.replace(/\D/g, '').slice(-3) });
  }
  if (url.hostname) return getDomainWithoutSuffix(url.hostname, { allowPrivateDomains: true }) ?? url.hostname;
  return decodeURIComponent(url.pathname);
}

function updateNamedTarget(tr: Transaction, range: SourceRange, href: string): Transaction {
  const { from, to, mark, image } = range;
  if (image) return tr.setNodeMarkup(from, undefined, { ...image.attrs, src: href });
  if (!mark) return tr;
  return tr.removeMark(from, to, mark).addMark(from, to, mark.type.create({ ...mark.attrs, href }));
}

export function insertLinkLabel(view: EditorView, range: SourceRange): void {
  if (range.mark || range.image) return;
  const { from, to, target } = range;
  const { doc, schema } = view.state;
  const $from = doc.resolve(from);
  const literal = $from.parent.type === schema.nodes.targetLiteral;
  const start = literal ? $from.before() : from;
  const end = literal ? $from.after() : to;
  const prefix = literal ? doc.textBetween($from.start(), from) : '';
  const suffix = literal ? doc.textBetween(to, $from.end()) : '';
  const marks = schema.marks.link.create({ href: target.value }).addToSet($from.nodeAfter?.marks ?? []);
  const label = defaultLinkLabel(target);
  const replacement = [schema.text(label, marks)];
  if (prefix) replacement.unshift(schema.text(prefix));
  if (suffix) replacement.push(schema.text(suffix));
  const tr = closeHistory(view.state.tr).replaceWith(start, end, replacement);
  const labelStart = start + prefix.length;
  tr.setSelection(TextSelection.create(tr.doc, labelStart, labelStart + label.length));
  view.dispatch(tr.setMeta('description:boundary', true));
  view.focus();
}

export function useTargetAsLabel(view: EditorView, range: SourceRange): void {
  if (!range.mark) return;
  const { from, to, target } = range;
  const { schema } = view.state;
  const text = target.kind === 'path' ? fileDropText([target.value]) : target.value;
  const tr = closeHistory(view.state.tr).replaceWith(from, to, schema.nodes.targetLiteral.create(null, schema.text(text)));
  tr.setSelection(TextSelection.create(tr.doc, from + 1 + text.length));
  view.dispatch(tr.setMeta('description:boundary', true));
  view.focus();
}

export function editTarget(view: EditorView, range: SourceRange): void {
  if (!range.mark && !range.image) return;
  const doc = view.state.doc;
  const { from, to, target } = range;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dodrag-target-input';
  input.setAttribute('aria-label', targetEditLabel(target));
  input.autocomplete = 'off'; input.spellcheck = false;
  input.value = target.value;
  const parsed = () => {
    const result = classifyTarget(input.value);
    return result?.kind === target.kind ? result : undefined;
  };
  const resize = () => {
    input.style.width = `${Math.max(12, input.value.length + 2)}ch`;
    input.setAttribute('aria-invalid', parsed() ? 'false' : 'true');
  };
  resize();
  input.addEventListener('input', resize);
  // The source remains in the model during entry, so a temporary partial URL
  // never reaches the draft or local undo. Replacing the destination is one edit.
  let finished = false;
  const finish = (save: boolean, direction?: -1 | 1) => {
    if (finished || view.isDestroyed || view.state.doc !== doc || !input.isConnected) return;
    finished = true;
    const changed = save && parsed();
    let tr = view.state.tr.setMeta(editing, DecorationSet.empty);
    if (changed && changed.value !== target.value) {
      tr = updateNamedTarget(closeHistory(tr), range, changed.value).setMeta('description:boundary', true);
    }
    if (direction) {
      const boundary = direction < 0 ? from : to;
      tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(boundary, direction)), direction));
    }
    view.dispatch(tr);
    if (direction) view.focus();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const caret = input.selectionStart === input.selectionEnd ? input.selectionStart : null;
    const left = event.key === 'ArrowLeft' && caret === 0;
    const right = event.key === 'ArrowRight' && caret === input.value.length;
    if (event.key !== 'Enter' && event.key !== 'Escape' && !left && !right) return;
    event.preventDefault(); event.stopPropagation();
    finish(event.key !== 'Escape', left ? -1 : 1);
  });
  const hidden = { class: 'dodrag-target-hidden' };
  view.dispatch(view.state.tr.setMeta(editing, DecorationSet.create(doc, [
    Decoration.widget(from, input, { side: -1, stopEvent: () => true }),
    range.image ? Decoration.node(from, to, hidden) : Decoration.inline(from, to, hidden),
  ])));
  input.focus();
  input.select();
}

export const TargetEditing = Extension.create({
  name: 'targetEditing',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: editing,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, old) => tr.getMeta(editing) ?? (tr.docChanged ? DecorationSet.empty : old),
      },
      props: {
        decorations(state) { return editing.getState(state); },
        handleKeyDown(view, event) {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
          const { state } = view;
          if (!state.selection.empty) return false;
          const { $from } = state.selection;
          const type = state.schema.marks.link;
          const marks = state.storedMarks ?? ($from.nodeAfter?.marks.some(mark => mark.type === type)
            ? $from.nodeAfter.marks : $from.nodeBefore?.marks ?? []);
          const link = marks.find(mark => mark.type === type);
          if (!link) return false;
          const adjacent = event.key === 'ArrowLeft' ? $from.nodeBefore : $from.nodeAfter;
          if (adjacent?.marks.some(mark => mark.eq(link))) return false;
          // A second caret affinity at the same text position lets arrows leave
          // a label without skipping a character in the surrounding prose.
          view.dispatch(state.tr.setStoredMarks([]));
          return true;
        },
        handleTextInput(view, from, to, text) {
          if (!text) return false;
          const { state } = view;
          if (from === to) {
            const $pos = state.doc.resolve(from);
            const marks = state.storedMarks ?? ($pos.nodeAfter?.marks.some(mark => mark.type.name === 'link')
              ? $pos.nodeAfter.marks : $pos.nodeBefore?.marks ?? []);
            const link = marks.find(mark => mark.type.name === 'link');
            if (!link) {
              if (state.storedMarks === null) return false;
              const tr = state.tr.insertText(text, from, to).setStoredMarks(state.storedMarks);
              view.dispatch(tr.scrollIntoView());
              return true;
            }
            const preceding = $pos.nodeBefore;
            if (text === ' ' && preceding?.isText && preceding.text?.endsWith(' ') &&
                preceding.marks.some(mark => mark.eq(link))) {
              const tr = state.tr.replaceWith(from - 1, to, state.schema.text(' '));
              tr.setSelection(TextSelection.create(tr.doc, from)).setStoredMarks([]);
              view.dispatch(tr.scrollIntoView());
              return true;
            }
            const tr = state.tr.replaceWith(from, to, state.schema.text(text, marks));
            tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks(marks);
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          const $from = state.doc.resolve(from);
          const marks = $from.nodeAfter?.marks ?? [];
          const mark = marks.find(candidate => candidate.type.name === 'link');
          if (!mark || !classifyTarget(mark.attrs.href ?? '')) return false;
          const range = getMarkRange($from, mark.type, mark.attrs);
          if (!range || from < range.from || to > range.to) return false;
          // ProseMirror normally drops a non-inclusive mark when typing over
          // a selection that ends at its boundary. The label remains a link.
          const tr = state.tr.replaceWith(from, to, state.schema.text(text, marks));
          tr.setSelection(TextSelection.create(tr.doc, from + text.length));
          if (to === range.to) tr.setStoredMarks(marks);
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    })];
  },
});
