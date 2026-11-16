import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { classifyTarget, isImagePath, mediaSource, tokenizeTargets } from './targets';
import { createSourceIcon } from './SourceIcon';
import type { EditorTarget } from './types';

export interface SourceRange {
  from: number;
  to: number;
  target: EditorTarget;
  mark?: Mark;
  image?: ProseMirrorNode;
}

const sources = new PluginKey<DecorationSet>('pathAndUrl');

export function sourceAtElement(view: EditorView, element: EventTarget | null, target: EditorTarget): SourceRange | undefined {
  if (!(element instanceof Element) || !view.dom.contains(element)) return;
  const surface = element.closest('[data-target-kind][data-target-value], a[href]');
  if (!surface) return;
  const image = surface.closest('[data-source-image]');
  const matches = (value: EditorTarget | undefined) => value?.kind === target.kind && value.value === target.value;
  if (image?.parentNode) {
    const from = view.posAtDOM(image.parentNode, Array.prototype.indexOf.call(image.parentNode.childNodes, image));
    const node = view.state.doc.nodeAt(from);
    if (node?.type.name === 'image' && matches(classifyTarget(String(node.attrs.src)))) return { from, to: from + node.nodeSize, target, image: node };
  }
  const pos = view.posAtDOM(surface, 0);
  return sources.getState(view.state)?.find(pos, pos, spec => !!spec.sourceRange)
    .map(deco => deco.spec.sourceRange as SourceRange)
    .find(range => matches(range.target));
}

function decorate(doc: ProseMirrorNode, taskId: string): DecorationSet {
  const decorations: Decoration[] = [];
  // Widget identity follows the source, not its absolute document position.
  // Typing before a path must retain its DOM and resolved native folder icon.
  const occurrences = new Map<string, number>();
  const sourceKey = (kind: string, value: string) => {
    const identity = `${kind}:${value}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return `${identity}:${occurrence}`;
  };
  const add = (range: SourceRange, label: string, preview: boolean) => {
    const { from, to, target } = range;
    // Keep a range decoration for lookup from text, the drag widget, or the
    // preview at the end. The decoration positions track the live document.
    decorations.push(Decoration.inline(from, to, range.mark ? {} : {
      'data-target-kind': target.kind, 'data-target-value': target.value,
      class: 'dodrag-editor-target text-sky-700 underline',
    }, { sourceRange: range }));
    decorations.push(Decoration.widget(from, () => createSourceIcon(target),
      { key: sourceKey(target.kind, target.value), side: -1, stopEvent: () => true }));
    if (preview) {
      decorations.push(Decoration.widget(to, () => {
        const image = document.createElement('img');
        image.src = mediaSource(taskId, target.value);
        image.alt = label;
        image.loading = 'lazy';
        image.dataset.targetKind = 'path'; image.dataset.targetValue = target.value;
        image.className = 'dodrag-editor-image max-h-64 max-w-full rounded-lg border border-slate-200 my-1.5 object-contain';
        image.contentEditable = 'false';
        return image;
      }, { key: `${taskId}:${sourceKey('image', target.value)}`, side: 1 }));
    }
  };
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code && parent.type.name !== 'targetLiteral' || node.marks.some(mark => mark.type.name === 'code')) return;
    const link = node.marks.find(mark => mark.type.name === 'link');
    if (link) {
      const target = classifyTarget(String(link.attrs.href ?? ''));
      const $pos = doc.resolve(pos);
      const range = target && getMarkRange($pos, link.type, link.attrs);
      if (target && range?.from === pos) {
        add({ ...range, target, mark: link }, doc.textBetween(range.from, range.to), target.kind === 'path' && isImagePath(target.value));
      }
      return;
    }
    const text = node.text ?? '';
    const literal = parent?.type.name === 'targetLiteral' && classifyTarget(text);
    if (literal && text === text.trim()) {
      add({ from: pos, to: pos + node.nodeSize, target: literal }, text, literal.kind === 'path' && isImagePath(literal.value));
      return;
    }
    for (const token of tokenizeTargets(text)) {
      const from = pos + token.start, to = pos + token.end;
      add({ from, to, target: token }, token.label ?? token.value, token.kind === 'path' && isImagePath(token.value));
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const PathAndUrlExtension = Extension.create<{ getTaskId: () => string }>({
  name: 'pathAndUrl',
  addOptions: () => ({ getTaskId: () => '' }),
  addProseMirrorPlugins() {
    const getTaskId = this.options.getTaskId;
    return [new Plugin({
      key: sources,
      state: {
        init: (_, state) => decorate(state.doc, getTaskId()),
        apply: (transaction, old, _oldState, state) => transaction.docChanged || transaction.getMeta('source:refresh') ? decorate(state.doc, getTaskId()) : old,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
