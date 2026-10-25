import type { EditorTarget } from './types';
import { t } from '../../i18n';

export interface TargetToken extends EditorTarget {
  start: number;
  end: number;
  image: boolean;
  label?: string;
}

export function classifyTarget(raw: string): EditorTarget | undefined {
  const value = raw.trim().replace(/^"(.*)"$/, '$1');
  if (/^https?:\/\/[^\s<>"\\]+$/i.test(value)) return { kind: 'url', value };
  if (/^(?:[a-z]:\\|\\\\[^\\\s/:*?"<>|]+\\[^\\/:*?"<>|]+)(?:[^:*?"<>|\r\n]*)$/i.test(value)) {
    return { kind: 'path', value };
  }
  return undefined;
}

export const isImagePath = (path: string): boolean => /\.(?:jpe?g|png|gif|webp|bmp|svg)$/i.test(path);
export const mediaSource = (taskId: string, path: string): string =>
  `/dodrag-media?taskId=${encodeURIComponent(taskId)}&path=${encodeURIComponent(path)}`;

// Quoted paths retain whitespace. Bare paths stop at whitespace; no filename guessing.
export function tokenizeTargets(text: string): TargetToken[] {
  const result: TargetToken[] = [];
  const pattern = /!\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]+)>|"([^"\r\n]+)"|((?:[a-z]:\\|\\\\)[^\r\n]*?)|([^\s)]+))\s*\)|"((?:[a-z]:\\|\\\\)[^"\r\n]*)"|https?:\/\/[^\s<>"]+|(?:[a-z]:\\|\\\\)[^\s<>"|:*?]*/gi;
  for (const match of text.matchAll(pattern)) {
    const markdownImage = match[0].startsWith('![');
    let value = markdownImage ? match[2] ?? match[3] ?? match[4] ?? match[5] : match[6] ?? match[0];
    if (!markdownImage && !match[6]) {
      value = value.replace(/[.,;!?]+$/, '');
      while (value.endsWith(')') && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
    }
    const target = classifyTarget(value);
    if (!target) continue;
    result.push({ ...target, start: match.index!, end: match.index! + (markdownImage || match[6] ? match[0].length : value.length),
      image: markdownImage || (target.kind === 'path' && isImagePath(target.value)), label: markdownImage ? match[1] : undefined });
  }
  return result;
}

export function targetFromElement(element: EventTarget | null): EditorTarget | undefined {
  if (!(element instanceof Element)) return undefined;
  const node = element.closest<HTMLElement>('[data-target-kind][data-target-value]');
  if (node) return classifyTarget(node.dataset.targetValue ?? '');
  const anchor = element.closest('a[href]');
  return anchor ? classifyTarget(anchor.getAttribute('href') ?? '') : undefined;
}

export const fileDropText = (paths: readonly string[]): string => paths.map(path => {
  // Reject malformed input rather than silently changing the destination filename.
  if (/[\x00-\x1f\x7f"<>|?*]/.test(path) || classifyTarget(path)?.kind !== 'path' ||
    /^\\\\[?.]\\/.test(path) || path.slice(/^[a-z]:/i.test(path) ? 2 : 0).includes(':')) {
    throw new Error(t('Ungültiger Dateipfad'));
  }
  return `"${path}"`;
}).join('\n');
