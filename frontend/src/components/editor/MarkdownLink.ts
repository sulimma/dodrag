import Link from '@tiptap/extension-link';
import type { MarkdownToken } from '@tiptap/core';

export const MarkdownLink = Link.extend({
  parseMarkdown(token, helpers) {
    const literalFeatures = (tokens: MarkdownToken[]): MarkdownToken[] => tokens.map(child => {
      if (['emoticon', 'inlineMath', 'targetLiteral'].includes(child.type ?? '')) return { type: 'text', raw: child.raw, text: child.raw };
      return child.tokens ? { ...child, tokens: literalFeatures(child.tokens) } : child;
    });
    return helpers.applyMark('link', helpers.parseInline(literalFeatures(token.tokens ?? [])), { href: token.href, title: token.title ?? null });
  },
});
