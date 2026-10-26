import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { classifyTarget, isImagePath, mediaSource, tokenizeTargets } from './targets';
import { createSourceIcon } from './SourceIcon';
import { sourceIsPlain } from './MarkdownTargets';
import type { EditorState } from '@tiptap/pm/state';

function decorate(doc: ProseMirrorNode, taskId: string, state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code && parent.type.name !== 'targetLiteral' || node.marks.some(mark => mark.type.name === 'code')) return;
    const link = node.marks.find(mark => mark.type.name === 'link');
    if (link) {
      const target = classifyTarget(String(link.attrs.href ?? ''));
      const previous = doc.resolve(pos).nodeBefore;
      if (target && !previous?.marks.some(mark => mark.eq(link))) decorations.push(Decoration.widget(pos,
        () => createSourceIcon(target), { side: -1, key: `source:${pos}:${target.value}`, stopEvent: () => true }));
      return;
    }
    for (const token of tokenizeTargets(node.text ?? '')) {
      if (sourceIsPlain(state, pos + token.start, pos + token.end)) continue;
      decorations.push(Decoration.inline(pos + token.start, pos + token.end, {
        'data-target-kind': token.kind, 'data-target-value': token.value,
        class: 'dodrag-editor-target text-sky-700 underline cursor-pointer',
      }));
      decorations.push(Decoration.widget(pos + token.start, () => createSourceIcon(token),
        { key: `source:${pos + token.start}:${token.value}`, side: -1, stopEvent: () => true }));
      if (token.kind === 'path' && isImagePath(token.value)) {
        decorations.push(Decoration.widget(pos + token.end, () => {
          const image = document.createElement('img');
          image.src = mediaSource(taskId, token.value);
          image.alt = token.label ?? token.value;
          image.loading = 'lazy';
          image.dataset.targetKind = 'path'; image.dataset.targetValue = token.value;
          image.className = 'dodrag-editor-image max-h-64 max-w-full rounded-lg border border-slate-200 my-1.5 object-contain cursor-pointer';
          image.contentEditable = 'false';
          return image;
        }, { key: `${taskId}:${pos + token.end}:${token.value}`, side: 1 }));
      }
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
      key: new PluginKey('pathAndUrl'),
      state: {
        init: (_, state) => decorate(state.doc, getTaskId(), state),
        apply: (transaction, old, _oldState, state) => transaction.docChanged || transaction.getMeta('source:refresh') ? decorate(state.doc, getTaskId(), state) : old,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
