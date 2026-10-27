import type { EditorTarget } from './types';
import { t } from '../../i18n';

export interface TargetToken extends EditorTarget {
  start: number;
  end: number;
  image: boolean;
  label?: string;
}

const emailAtom = String.raw`[a-z0-9!#$%&'*+/=?^_\x60{|}~-]+`;
const emailLocal = String.raw`(?:${emailAtom}(?:\.${emailAtom})*|"[^"@\x00-\x1f\x7f-\x9f]+(?<!\\)")`;
const emailAddress = String.raw`${emailLocal}@[a-z0-9]+(?:\.[a-z0-9]+)+`;
const rawEmailPattern = new RegExp(`^(${emailLocal})@([a-z0-9]+(?:\\.[a-z0-9]+)+)$`, 'i');

export function classifyTarget(raw: string): EditorTarget | undefined {
  const email = raw.trim().match(rawEmailPattern);
  if (email && !/[\x00-\x1f\x7f-\x9f]/.test(raw)) {
    try {
      const local = encodeURIComponent(email[1]).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      return { kind: 'url', value: `mailto:${local}@${email[2]}` };
    } catch { return; }
  }
  let value = raw.trim().replace(/^"(.*)"$/, '$1');
  if (/^tel:\+?[\d ()_-]+$/i.test(value) && /\d/.test(value.slice(4))) value = `tel:${value.slice(4).replace(/[ ()_-]/g, '')}`;
  if (/^(?:https?:|mailto:|sip:|tel:)/i.test(value)) {
    if (/[\s<>"\\\x00-\x1f\x7f]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return;
    try {
      if (/[\x00-\x1f\x7f]/.test(decodeURIComponent(value))) return;
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol)) {
        if (!/^https?:\/\/[^/]/i.test(value) || !url.hostname || url.username || url.password) return;
      } else {
        if (url.host || value.slice(value.indexOf(':') + 1).startsWith('//') || !url.pathname || url.hash) return;
        if (url.protocol === 'tel:' && (!/^\+?[\d()_-]+$/.test(url.pathname) || !/\d/.test(url.pathname) || url.search || url.pathname.replace(/\D/g, '').length > 15)) return;
        if (url.protocol === 'mailto:' && !/^[^@?]+@[^@?]+$/.test(url.pathname)) return;
        if (url.protocol === 'sip:' && (!/^[\w.+:;=@%\[\]-]+$/.test(url.pathname) || url.search)) return;
      }
      return { kind: 'url', value };
    } catch { return; }
  }
  if (/^(?:[a-z]:\\|\\\\[^\\\s/:*?"<>|]+\\[^\\/:*?"<>|]+)(?:[^:*?"<>|\r\n]*)$/i.test(value)) {
    if (/[\x00-\x1f\x7f]/.test(value) || /^\\\\[?.]\\/.test(value)) return;
    return { kind: 'path', value };
  }
  if (/^\+?[\d(][\d ()_-]*[\d)]$/.test(value) && !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) return { kind: 'url', value: `tel:${value.startsWith('+') ? '+' : ''}${digits}` };
  }
  return undefined;
}

export const SOURCE_MIME = 'application/x-dodrag-source';

export function parseSourcePayload(raw: string): EditorTarget | undefined {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('kind' in data) || !('value' in data) || typeof data.value !== 'string') return;
    const target = classifyTarget(data.value);
    return target?.kind === data.kind ? target : undefined;
  } catch { return; }
}

export const isImagePath = (path: string): boolean => /\.(?:jpe?g|png|gif|webp|bmp|svg)$/i.test(path);
export const mediaSource = (taskId: string, path: string): string =>
  `/dodrag-media?taskId=${encodeURIComponent(taskId)}&path=${encodeURIComponent(path)}`;

// Quoted paths retain whitespace. Bare paths stop at whitespace; no filename guessing.
export function tokenizeTargets(text: string): TargetToken[] {
  const result: TargetToken[] = [];
  // Consume ISO dates/timestamps before the phone branch can take a date plus hour or timezone.
  const pattern = new RegExp(String.raw`(?<iso>(?<![\w])\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)|!\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]+)>|"([^"\r\n]+)"|((?:[a-z]:\\|\\\\)[^\r\n]*?)|([^\s)]+))\s*\)|"((?:[a-z]:\\|\\\\)[^"\r\n]*)"|tel:\+?[\d(][\d ()_-]*[\d)]|(?:https?:\/\/|mailto:|sip:|tel:)[^\s<>"]+|(?:[a-z]:\\|\\\\)[^\s<>"|:*?]*|(?<![a-z0-9!#$%&'*+/=?^_\x60{|}~.@:"\\-])(?<email>${emailAddress})(?![a-z0-9@_-]|\.[a-z0-9.])|(?<![\w+:(/-])\+?[\d(][\d ()_-]*[\d)](?![\w+()-])`, 'gi');
  for (const match of text.matchAll(pattern)) {
    if (match.groups?.iso) continue;
    const markdownImage = match[0].startsWith('![');
    let value = markdownImage ? match[3] ?? match[4] ?? match[5] ?? match[6] : match[7] ?? match[0];
    if (!markdownImage && !match[7] && !match.groups?.email) {
      value = value.replace(/[.,;!?]+$/, '');
      while (value.endsWith(')') && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) value = value.slice(0, -1);
    }
    const target = classifyTarget(value);
    if (!target) continue;
    result.push({ ...target, start: match.index!, end: match.index! + (markdownImage || match[7] ? match[0].length : value.length),
      image: markdownImage || (target.kind === 'path' && isImagePath(target.value)), label: markdownImage ? match[2] : undefined });
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
