import Image, { type ImageOptions } from '@tiptap/extension-image';
import { classifyTarget, mediaSource, tokenizeTargets } from './targets';

const configuredParsers = new WeakSet<object>();
export const LocalImage = Image.extend<{ getTaskId: () => string } & ImageOptions>({
  addOptions() { return { ...this.parent?.(), getTaskId: () => '', inline: true, allowBase64: false, HTMLAttributes: {} }; },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const src = String(node.attrs.src ?? '');
          const alt = String(node.attrs.alt ?? '').replace(/[\[\]]/g, '');
          state.write(`![${alt}](<${src}>)`);
        },
        parse: {
          setup(markdown: any) {
            if (configuredParsers.has(markdown)) return;
            configuredParsers.add(markdown);
            markdown.inline.ruler.before('text', 'dodrag-windows-path', (state: any, silent: boolean) => {
              const match = tokenizeTargets(state.src.slice(state.pos))[0];
              if (!match || match.kind !== 'path' || state.src.slice(state.pos + match.start).startsWith('![')) return false;
              // Consume plain prose before a path too, before markdown-it splits at the drive colon.
              if (/[\n!#$%&*+\-:<=>@[\\\]^_`{}~]/.test(state.src.slice(state.pos, state.pos + match.start))) return false;
              if (!silent) state.pending += state.src.slice(state.pos, state.pos + match.end);
              state.pos += match.end;
              return true;
            });
            // Markdown normally unescapes Windows backslashes and rejects drive-letter image URIs.
            markdown.inline.ruler.before('image', 'dodrag-local-image', (state: any, silent: boolean) => {
              if (!state.src.startsWith('![', state.pos)) return false;
              const match = tokenizeTargets(state.src.slice(state.pos))[0];
              if (!match || match.start !== 0 || !match.image || match.kind !== 'path') return false;
              if (!silent) {
                const token = state.push('image', 'img', 0);
                token.attrs = [['src', match.value], ['alt', match.label ?? '']];
                const child = new state.Token('text', '', 0); child.content = match.label ?? '';
                token.children = [child]; token.content = match.label ?? '';
              }
              state.pos += match.end;
              return true;
            });
          },
        },
      },
    };
  },
  addNodeView() {
    const getTaskId = this.options.getTaskId;
    return ({ node }) => {
      const image = document.createElement('img');
      const update = (next: typeof node) => {
        if (next.type !== node.type) return false;
        const target = classifyTarget(String(next.attrs.src ?? ''));
        if (target) {
          image.src = target.kind === 'path' ? mediaSource(getTaskId(), target.value) : target.value;
          image.dataset.targetKind = target.kind; image.dataset.targetValue = target.value;
        } else { image.removeAttribute('src'); delete image.dataset.targetKind; delete image.dataset.targetValue; }
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
      return { dom: image, update, destroy: () => this.editor.off('transaction', refresh) };
    };
  },
});
