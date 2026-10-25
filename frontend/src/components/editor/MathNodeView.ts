import type { NodeViewRenderer } from '@tiptap/core';
import katex, { type KatexOptions } from 'katex';
import { t } from '../../i18n';

export function mathNodeView(block: boolean, options?: KatexOptions): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    const dom = document.createElement(block ? 'div' : 'span');
    dom.dataset.type = block ? 'block-math' : 'inline-math';
    dom.className = 'tiptap-mathematics-render';
    const preview = document.createElement('span');
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', t(block ? 'Formelblock' : 'Formel'));
    input.rows = block ? 3 : 1;
    input.hidden = true;
    dom.append(preview, input);
    const render = () => {
      const label = t(block ? 'Formelblock' : 'Formel');
      input.setAttribute('aria-label', label);
      preview.setAttribute('aria-label', label);
      preview.setAttribute('role', editor.isEditable ? 'button' : 'math');
      preview.tabIndex = editor.isEditable ? 0 : -1;
      dom.dataset.latex = node.attrs.latex;
      if (document.activeElement !== input) input.value = node.attrs.latex;
      try { katex.render(node.attrs.latex, preview, { ...options, displayMode: block, trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20 }); }
      catch { preview.textContent = node.attrs.latex; }
    };
    const edit = (event: Event) => {
      if (!editor.isEditable || event.target === input) return;
      event.preventDefault(); event.stopPropagation();
      input.setAttribute('aria-label', t(block ? 'Formelblock' : 'Formel'));
      input.hidden = false; preview.hidden = true; input.value = node.attrs.latex; input.focus();
    };
    dom.addEventListener('click', edit);
    preview.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') edit(event); });
    const refresh = () => render();
    editor.on('transaction', refresh);
    input.addEventListener('input', () => {
      const pos = getPos();
      if (pos === undefined || editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: input.value }));
    });
    input.addEventListener('blur', () => { input.hidden = true; preview.hidden = false; render(); });
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape' && !(event.key === 'Enter' && (event.ctrlKey || !block))) return;
      event.preventDefault(); event.stopPropagation(); input.blur(); editor.view.focus();
    });
    render();
    return { dom, stopEvent: event => event.target === input || event.target === preview && event.type === 'keydown', ignoreMutation: () => true,
      destroy() { editor.off('transaction', refresh); },
      update(next) { if (next.type !== node.type) return false; node = next; render(); return true; } };
  };
}
