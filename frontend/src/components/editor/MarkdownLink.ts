import Link from '@tiptap/extension-link';
import type { MarkdownToken } from '@tiptap/core';
import { classifyTarget } from './targets';

function markdownLink(text: string, href: string, title = ''): string {
  const escaped = href.replaceAll('\\', '\\\\');
  const destination = /[\s\\()<>]/.test(href) ? '<' + escaped.replace(/[<>]/g, '\\$&') + '>' : escaped;
  return '[' + text + '](' + destination + (title ? ' "' + title.replace(/[\\"]/g, '\\$&') + '"' : '') + ')';
}

export const MarkdownLink = Link.extend({
  parseMarkdown(token, helpers) {
    const destination = classifyTarget(token.href ?? '');
    if (destination?.kind === 'url' && token.raw?.startsWith('<') && token.raw.endsWith('>') && token.text) {
      return { type: 'targetLiteral', content: [{ type: 'text', text: token.text }] };
    }
    const literalFeatures = (tokens: MarkdownToken[]): MarkdownToken[] => tokens.map(child => {
      if (['emoticon', 'inlineMath', 'targetLiteral', 'link'].includes(child.type ?? '')) {
        // Target tokens bypass Markdown escapes when bare, but within a label
        // they still follow the ordinary Markdown text escaping rules.
        const text = (child.raw ?? child.text ?? '').replace(/\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g, '$1');
        return { type: 'text', raw: child.raw, text };
      }
      return child.tokens ? { ...child, tokens: literalFeatures(child.tokens) } : child;
    });
    return helpers.applyMark('link', helpers.parseInline(literalFeatures(token.tokens ?? [])), { href: token.href, title: token.title ?? null });
  },
  renderMarkdown(node, helpers) {
    return markdownLink(helpers.renderChildren(node), node.attrs?.href ?? '', node.attrs?.title ?? '');
  },
}).configure({
  // Absolute Windows paths also use ordinary Markdown links when they have
  // a label. Opening them is still routed through the validated native menu.
  isAllowedUri: (href, { defaultValidate }) => classifyTarget(href)?.kind === 'path' || defaultValidate(href),
  HTMLAttributes: { draggable: 'false' },
});
