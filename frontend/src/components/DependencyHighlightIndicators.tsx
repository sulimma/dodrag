import React, { RefObject, useLayoutEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';

export function DependencyHighlightIndicators({ scrollRef, contentKey, horizontal }: {
  scrollRef: RefObject<HTMLElement>;
  contentKey: unknown;
  horizontal: boolean;
}) {
  const [counts, setCounts] = useState({ predecessors: 0, successors: 0 });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rows = () => Array.from(scroll.querySelectorAll<HTMLElement>('[data-dependency-highlight]'));
    let frame = 0;
    const measure = () => {
      const viewport = scroll.getBoundingClientRect();
      const start = horizontal ? viewport.left + scroll.clientLeft : viewport.top + scroll.clientTop;
      const end = start + (horizontal ? scroll.clientWidth : scroll.clientHeight);
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
      setCounts(previous => previous.predecessors === predecessors && previous.successors === successors
        ? previous : { predecessors, successors });
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
          aria-label={`${counts.predecessors} hervorgehobene Vorgänger ${horizontal ? 'links' : 'oberhalb'} des sichtbaren Bereichs`}
          className={`absolute ${horizontal ? 'left-2 top-1/2 -translate-y-1/2' : 'top-2 left-6'} flex items-center gap-1 rounded-lg border border-amber-500 bg-amber-100 text-amber-800 px-2 py-1 text-sm font-semibold shadow-md`}>
          <PredecessorArrow className="w-5 h-5 text-amber-500" aria-hidden="true" />
          {counts.predecessors}
        </div>
      )}
      {counts.successors > 0 && (
        <div data-dependency-indicator="successor" role="status"
          aria-label={`${counts.successors} hervorgehobene Nachfolger ${horizontal ? 'rechts' : 'unterhalb'} des sichtbaren Bereichs`}
          className={`absolute ${horizontal ? 'right-2 top-1/2 -translate-y-1/2' : 'bottom-2 left-6'} flex items-center gap-1 rounded-lg border border-purple-500 bg-purple-100 text-purple-800 px-2 py-1 text-sm font-semibold shadow-md`}>
          <SuccessorArrow className="w-5 h-5 text-purple-500" aria-hidden="true" />
          {counts.successors}
        </div>
      )}
    </div>
  );
}
