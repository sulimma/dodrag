import React, { RefObject, useLayoutEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { t, formatNumber } from '../i18n';

// Counts highlighted dependencies currently outside the scroll viewport.
export function DependencyHighlightIndicators({ scrollRef, contentKey, horizontal }: {
  scrollRef: RefObject<HTMLElement>;
  contentKey: unknown;
  horizontal: boolean;
}) {
  const [counts, setCounts] = useState({ predecessors: 0, successors: 0, predecessorLeft: 8 });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rows = () => Array.from(scroll.querySelectorAll<HTMLElement>('[data-dependency-highlight]'));
    let frame = 0;
    const measure = () => {
      const viewport = scroll.getBoundingClientRect();
      const scrollStart = horizontal ? viewport.left + scroll.clientLeft : viewport.top + scroll.clientTop;
      const list = horizontal ? scroll.querySelector<HTMLElement>('[data-gantt-list]') : null;
      const listRect = list?.getBoundingClientRect();
      const start = listRect ? listRect.right : scrollStart;
      const end = scrollStart + (horizontal ? scroll.clientWidth : scroll.clientHeight);
      const overlayLeft = scroll.parentElement?.getBoundingClientRect().left ?? viewport.left;
      const predecessorLeft = listRect ? listRect.right - overlayLeft + 8 : 8;
      let predecessors = 0;
      let successors = 0;
      // Partially visible rows still count as shown; only fully hidden rows contribute.
      for (const row of rows()) {
        const rect = row.getBoundingClientRect();
        const side = row.dataset.highlightSide;
        const before = side ? side === 'before' : (horizontal ? rect.right : rect.bottom) <= start;
        const after = side ? side === 'after' : (horizontal ? rect.left : rect.top) >= end;
        if (row.dataset.dependencyHighlight === 'predecessor' && before) predecessors++;
        if (row.dataset.dependencyHighlight === 'successor' && after) successors++;
      }
      setCounts(previous => previous.predecessors === predecessors && previous.successors === successors && previous.predecessorLeft === predecessorLeft
        ? previous : { predecessors, successors, predecessorLeft });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // IntersectionObserver also tracks rows crossing the viewport during FLIP animations.
    const intersections = new IntersectionObserver(schedule, { root: scroll });
    const observeRows = () => {
      intersections.disconnect();
      rows().filter(row => !row.dataset.highlightSide).forEach(row => intersections.observe(row));
      schedule();
    };
    observeRows();
    // Gantt window navigation replaces nodes without changing the selected task.
    const mutations = new MutationObserver(observeRows);
    mutations.observe(scroll, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-dependency-highlight', 'data-highlight-side'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    if (scroll.firstElementChild) resize.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      intersections.disconnect();
      mutations.disconnect();
      resize.disconnect();
      scroll.removeEventListener('scroll', schedule);
    };
  }, [scrollRef, contentKey, horizontal]);

  const PredecessorArrow = horizontal ? ArrowLeft : ArrowUp;
  const SuccessorArrow = horizontal ? ArrowRight : ArrowDown;

  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-live="polite" aria-atomic="true">
      {counts.predecessors > 0 && (
        <div data-dependency-indicator="predecessor" role="status"
          aria-label={horizontal ? t('{count} hervorgehobene Vorgänger links des sichtbaren Bereichs', { count: formatNumber(counts.predecessors) }) : t('{count} hervorgehobene Vorgänger oberhalb des sichtbaren Bereichs', { count: formatNumber(counts.predecessors) })}
          style={horizontal ? { left: counts.predecessorLeft } : undefined}
          className={`absolute ${horizontal ? 'top-1/2 -translate-y-1/2' : 'top-2 left-6'} flex items-center gap-1 rounded-lg border border-amber-500 bg-amber-100 text-amber-800 px-2 py-1 text-sm font-semibold shadow-md`}>
          <PredecessorArrow className="w-5 h-5 text-amber-500" aria-hidden="true" />
          {formatNumber(counts.predecessors)}
        </div>
      )}
      {counts.successors > 0 && (
        <div data-dependency-indicator="successor" role="status"
          aria-label={horizontal ? t('{count} hervorgehobene Nachfolger rechts des sichtbaren Bereichs', { count: formatNumber(counts.successors) }) : t('{count} hervorgehobene Nachfolger unterhalb des sichtbaren Bereichs', { count: formatNumber(counts.successors) })}
          className={`absolute ${horizontal ? 'right-2 top-1/2 -translate-y-1/2' : 'bottom-2 left-6'} flex items-center gap-1 rounded-lg border border-purple-500 bg-purple-100 text-purple-800 px-2 py-1 text-sm font-semibold shadow-md`}>
          <SuccessorArrow className="w-5 h-5 text-purple-500" aria-hidden="true" />
          {formatNumber(counts.successors)}
        </div>
      )}
    </div>
  );
}
