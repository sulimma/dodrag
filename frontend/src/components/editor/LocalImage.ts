import Image, { type ImageOptions } from '@tiptap/extension-image';
import { classifyTarget, mediaSource, tokenizeTargets } from './targets';
import { createSourceIcon } from './SourceIcon';

export const LocalImage = Image.extend<{ getTaskId: () => string } & ImageOptions>({
  addOptions() { return { ...this.parent?.(), getTaskId: () => '', inline: true, allowBase64: false, HTMLAttributes: {}, resize: false }; },
  renderMarkdown(node) { return `![${String(node.attrs?.alt ?? '').replace(/[\[\]]/g, '')}](<${node.attrs?.src ?? ''}>)`; },
  markdownTokenizer: {
    name: 'image', level: 'inline', start: source => source.indexOf('!['),
    tokenize(source) {
      const match = tokenizeTargets(source)[0];
      if (!source.startsWith('![') || !match || match.start !== 0 || match.kind !== 'path') return;
      return { type: 'image', raw: source.slice(0, match.end), href: match.value, text: match.label ?? '' };
    },
  },
  addNodeView() {
    const getTaskId = this.options.getTaskId;
    return ({ node }) => {
      const container = document.createElement('span');
      container.contentEditable = 'false';
      const image = document.createElement('img');
      container.append(image);
      const update = (next: typeof node) => {
        if (next.type !== node.type) return false;
        const target = classifyTarget(String(next.attrs.src ?? ''));
        if (target) {
          image.src = target.kind === 'path' ? mediaSource(getTaskId(), target.value) : /^https?:/i.test(target.value) ? target.value : '';
          image.dataset.targetKind = target.kind; image.dataset.targetValue = target.value;
        } else { image.removeAttribute('src'); delete image.dataset.targetKind; delete image.dataset.targetValue; }
        container.querySelector('[data-source-drag]')?.remove();
        if (target) container.prepend(createSourceIcon(target));
        image.alt = String(next.attrs.alt ?? next.attrs.src ?? '');
        return true;
      };
      image.loading = 'lazy';
      image.className = 'max-h-64 max-w-full rounded-lg border border-slate-200 my-1.5 object-contain cursor-pointer';
      update(node);
      const refresh = () => {
        if (image.dataset.targetKind === 'path') image.src = mediaSource(getTaskId(), image.dataset.targetValue!);
      };
      this.editor.on('transaction', refresh);
      return { dom: container, update, destroy: () => this.editor.off('transaction', refresh) };
    };
  },
});
