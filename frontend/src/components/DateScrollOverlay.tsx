import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ScrollDateMarker { dateKey: string; offset?: number }
interface DateScrollOverlayProps {
  scrollRef?: React.RefObject<HTMLElement>;
  contentRef: React.RefObject<HTMLElement>;
  dates: readonly ScrollDateMarker[];
  height: number;
  contentHeight?: number;
  refreshKey?: unknown;
  renderDate: (dateKey: string) => React.ReactNode;
}

// Composition rather than a scroll-list base class: List measures its flowing
// dividers, Network supplies layout offsets, Protocol supplies virtual offsets.
// One fixed sibling portal never scrolls with the content. Originals stay in
// place; the next divider pushes the copy out. Render callbacks share the exact
// original date appearance and drop actions. No per-view scroll compensation.
export function DateScrollOverlay({ scrollRef, contentRef, dates, height, contentHeight, refreshKey, renderDate }: DateScrollOverlayProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [overlay, setOverlay] = useState({ dateKey: '', y: 0, width: 0, left: 0, top: 0 });
  const measureRef = useRef<() => void>(() => {});
  useEffect(() => {
    const scroll = scrollRef?.current, content = contentRef.current;
    const parent = scroll?.parentElement;
    if (!scroll || !content || !parent) return;
    setHost(parent);
    let frame = 0;
    const fixedMarkers = dates.every(date => date.offset !== undefined)
      ? dates as readonly { dateKey: string; offset: number }[] : null;
    const measure = () => {
      const viewportRect = scroll.getBoundingClientRect(), parentRect = parent.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const top = viewportRect.top + scroll.clientTop - contentRect.top;
      // Read only originals inside the content, never this portal's copy.
      const positions = new Map<string, number>();
      if (!fixedMarkers) {
        for (const node of content.querySelectorAll<HTMLElement>('[data-date-divider]')) {
          positions.set(node.dataset.dateDivider!, node.getBoundingClientRect().top - contentRect.top);
        }
      }
      const markers = fixedMarkers ?? dates.map(date => ({ ...date, offset: date.offset ?? positions.get(date.dateKey) }))
        .filter((date): date is { dateKey: string; offset: number } => date.offset !== undefined);
      let low = 0, high = markers.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (markers[middle].offset <= top) low = middle + 1;
        else high = middle;
      }
      const index = low - 1, current = markers[index];
      const next = { dateKey: current?.dateKey ?? '',
        y: Math.min(0, (markers[index + 1]?.offset ?? contentHeight ?? contentRect.height) - top - height),
        width: scroll.clientWidth, left: viewportRect.left - parentRect.left + scroll.clientLeft,
        top: viewportRect.top - parentRect.top + scroll.clientTop };
      setOverlay(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    measureRef.current = measure;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resize?.observe(scroll); resize?.observe(content);
    // Flowing list dividers can move during FLIP without a resize.
    const intersections = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(schedule, { root: scroll }) : null;
    content.querySelectorAll('[data-date-divider]').forEach(node => intersections?.observe(node));
    scroll.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      measureRef.current = () => {};
      cancelAnimationFrame(frame); resize?.disconnect(); intersections?.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, [scrollRef, contentRef, dates, height, contentHeight]);
  // Programmatic scrolling (e.g. Protocol's initial jump to the end) may happen
  // in a parent's layout effect, before the browser delivers its scroll event.
  useLayoutEffect(() => { measureRef.current(); }, [refreshKey]);
  if (!host || !overlay.dateKey || !dates.some(date => date.dateKey === overlay.dateKey)) return null;
  return createPortal(
    <div data-date-overlay className="absolute z-30 overflow-hidden pointer-events-none"
      style={{ top: overlay.top, left: overlay.left, width: overlay.width, height }}>
      <div data-date-context={overlay.dateKey} className="px-6 bg-slate-100 pointer-events-auto"
        style={{ height, transform: `translateY(${overlay.y}px)` }}>
        {renderDate(overlay.dateKey)}
      </div>
    </div>, host);
}
