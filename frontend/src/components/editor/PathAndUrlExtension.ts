import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isImagePath, mediaSource, tokenizeTargets } from './targets';

function decorate(doc: ProseMirrorNode, taskId: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code || node.marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return;
    for (const token of tokenizeTargets(node.text ?? '')) {
      decorations.push(Decoration.inline(pos + token.start, pos + token.end, {
        'data-target-kind': token.kind, 'data-target-value': token.value,
        class: 'dodrag-editor-target text-sky-700 underline cursor-pointer',
      }));
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
        init: (_, state) => decorate(state.doc, getTaskId()),
        apply: (transaction, old) => transaction.docChanged ? decorate(transaction.doc, getTaskId()) : old,
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
