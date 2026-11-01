import type { JSONContent } from '@tiptap/core';
import { eventBridge } from '../../bridge/eventBridge';
import type { EditorTarget } from './types';

export type DescriptionAddition = EditorTarget | { kind: 'markdown'; value: string };
export const isMarkdownPath = (value: string): boolean => /\.md$/i.test(value);

// Resolve the entire group before publishing it, so a failed file read never
// leaves a partially imported drop. Preserve Explorer ordering for mixed drops.
export function readMarkdownSources(sources: readonly EditorTarget[]): Promise<DescriptionAddition[]> {
  return Promise.all(sources.map(async source => source.kind === 'path' && isMarkdownPath(source.value)
    ? { kind: 'markdown' as const, value: await eventBridge.readMarkdownFile(source.value) } : source));
}

// Plain paragraphs/text alone are not evidence of Markdown. Recognized marks
// or structural nodes (lists, headings, code, alerts, math, etc.) are. This uses
// the editor's actual parser and automatically includes its custom syntax.
export function hasMarkdownFormatting(node: JSONContent): boolean {
  return !!node.marks?.length ||
    !!node.type && !['doc', 'paragraph', 'text'].includes(node.type) ||
    !!node.content?.some(hasMarkdownFormatting);
}
