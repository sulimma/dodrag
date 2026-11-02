import { useLayoutEffect } from 'react';
import { searchPattern } from '../domain/search';

// CSS highlights paint DOM ranges without inserting wrappers into React/Tiptap,
// changing selection, editor history, link targets or drag geometry. Rebuild on
// DOM updates too (virtual rows, live editing, detail/task switches).
export function searchRanges(root: HTMLElement, query: string): Range[] {
  const pattern = searchPattern(query);
  if (!pattern) return [];
  let text = '';
  const pieces: { node: Text; start: number; end: number }[] = [];
  const visit = (node: Node) => {
    if (node instanceof Text) {
      pieces.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
    } else if (node instanceof Element) {
      if (node.matches('script,style,input,textarea,[hidden],[inert],[data-search-ignore]')) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const boundary = node.tagName === 'BR' || /^(block|flex|grid|table|list-item)/.test(style.display);
      if (boundary && text && !text.endsWith('\n')) text += '\n';
      node.childNodes.forEach(visit);
      if (boundary && !text.endsWith('\n')) text += '\n';
    }
  };
  visit(root);
  const ranges: Range[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length;
    while (cursor < pieces.length && pieces[cursor].end <= start) cursor++;
    const first = pieces[cursor];
    if (!first || first.start >= end) continue;
    let lastIndex = cursor;
    while (lastIndex + 1 < pieces.length && pieces[lastIndex + 1].start < end) lastIndex++;
    const last = pieces[lastIndex];
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first.node, Math.max(0, start - first.start));
    range.setEnd(last.node, Math.min(last.node.length, end - last.start));
    ranges.push(range);
  }
  return ranges;
}

// Form controls have no DOM text ranges. Paint a non-interactive, clipped mirror
// over their text instead; the real textarea still owns caret, selection and IME.
// The omni field itself is the query, so it is deliberately excluded.
export function paintSearchFields(layer: HTMLElement, query: string) {
  layer.replaceChildren();
  for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea,input[type="text"]')) {
    if (field.closest('[hidden],[inert],[data-search-ignore]')) continue;
    const style = getComputedStyle(field), rect = field.getBoundingClientRect();
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
    const pattern = searchPattern(query);
    if (!pattern) continue;
    const matches = [...field.value.matchAll(pattern)];
    if (!matches.length) continue;
    let left = rect.left, top = rect.top, right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    // Match the native clipping of scrolled editor/log/detail panels.
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      const clipping = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(clipping.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
      if (/(auto|scroll|hidden|clip)/.test(clipping.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
    }
    if (right <= left || bottom <= top) continue;
    const clip = document.createElement('div'), mirror = document.createElement('div');
    Object.assign(clip.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, overflow: 'hidden' });
    for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'text-transform', 'direction', 'word-break', 'overflow-wrap', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']) {
      mirror.style.setProperty(property, style.getPropertyValue(property));
    }
    Object.assign(mirror.style, { position: 'absolute', boxSizing: 'border-box', color: 'transparent', borderStyle: 'solid', borderColor: 'transparent',
      whiteSpace: field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre',
      left: `${rect.left - left - field.scrollLeft}px`, top: `${rect.top - top - field.scrollTop}px`,
      width: `${field.clientWidth + parseFloat(style.borderLeftWidth || '0') + parseFloat(style.borderRightWidth || '0')}px`, minHeight: `${rect.height}px` });
    let offset = 0;
    for (const match of matches) {
      mirror.append(document.createTextNode(field.value.slice(offset, match.index)));
      const mark = document.createElement('mark'); mark.textContent = match[0];
      Object.assign(mark.style, { color: 'transparent', backgroundColor: 'rgba(250, 204, 21, 0.45)' });
      mirror.append(mark); offset = match.index! + match[0].length;
    }
    mirror.append(document.createTextNode(field.value.slice(offset)));
    clip.append(mirror); layer.append(clip);
  }
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
export function useSearchHighlight(query: string) {
  useLayoutEffect(() => {
    const css = globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry };
    const HighlightType = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!css?.highlights || !HighlightType) return;
    const registry = css.highlights;
    if (!query) { registry.delete('omni-search'); return; }
    const layer = document.createElement('div');
    layer.dataset.searchIgnore = 'true'; layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '40' });
    document.body.append(layer);
    let queued = false, active = true;
    const update = () => {
      queued = false;
      if (!active) return;
      registry.set('omni-search', new HighlightType(...searchRanges(document.body, query)));
      paintSearchFields(layer, query);
    };
    const schedule = () => { if (!queued) { queued = true; queueMicrotask(update); } };
    const observer = new MutationObserver(changes => {
      if (changes.some(change => !layer.contains(change.target))) schedule();
    });
    document.addEventListener('input', schedule, true);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'inert', 'class', 'style', 'open'] });
    update();
    return () => {
      active = false; observer.disconnect(); registry.delete('omni-search'); layer.remove();
      document.removeEventListener('input', schedule, true); document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [query]);
}
