import React, { useLayoutEffect, useRef } from 'react';

interface SmoothFlipListProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Key of the primary item that was actively moved by the user (e.g. "task:26-101"),
   * so it stays elevated above stationary/block-shifted items during the transition.
   */
  movedItemKey?: string | null;
}

/**
 * Deterministic, synchronous FLIP (First-Last-Invert-Play) list container.
 *
 * Guarantees:
 * - Zero overshoot / zero wobble at the end (uses a smooth cubic-bezier easing, no springs).
 * - Synchronous measurement in useLayoutEffect before browser paint:
 *   - Unchanged blocks move with the exact same pixel delta and identical timing as one cohesive unit.
 *   - The moved item glides directly from its old slot to its final slot in a single straight motion.
 *   - No post-animation layout readjustment or jitter.
 */
export function SmoothFlipList({
  children,
  className = '',
  movedItemKey = null,
}: SmoothFlipListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevTopsRef = useRef<Map<string, number>>(new Map());
  const animationsRef = useRef<Map<string, Animation>>(new Map());
  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const elements = Array.from(
      container.querySelectorAll<HTMLElement>('[data-flip-key]')
    );

    // 1. Capture current VISUAL positions of any elements that might already be mid-flight,
    //    and cancel running Web Animations so the DOM is in its clean, final layout state.
    const currentVisualTops = new Map<string, number>();
    const containerRect = container.getBoundingClientRect();

    for (const el of elements) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const runningAnim = animationsRef.current.get(key);
      if (runningAnim && runningAnim.playState === 'running') {
        const transform = getComputedStyle(el).transform;
        const offset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
        currentVisualTops.set(key, (prevTopsRef.current.get(key) ?? el.getBoundingClientRect().top - containerRect.top) + offset);
        runningAnim.oncancel = null;
        runningAnim.onfinish = null;
        runningAnim.cancel();
        animationsRef.current.delete(key);
        el.style.zIndex = ''; el.style.position = '';
      }
    }

    // 2. Measure clean, final DOM layout positions (single synchronous reflow)
    const nextTops = new Map<string, number>();
    const updatedContainerRect = container.getBoundingClientRect();

    for (const el of elements) {
      const key = el.dataset.flipKey;
      if (!key) continue;
      const rect = el.getBoundingClientRect();
      nextTops.set(key, rect.top - updatedContainerRect.top);
    }

    // 3. Apply synchronous FLIP animations where deltaY != 0
    const prevTops = prevTopsRef.current;
    const isInitialRender = prevTops.size === 0;

    if (!isInitialRender && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of elements) {
        const key = el.dataset.flipKey;
        if (!key) continue;

        const targetTop = nextTops.get(key)!;
        const startTop =
          currentVisualTops.get(key) ?? prevTops.get(key);

        if (startTop === undefined) {
          // Newly inserted item: subtle fade-in in place without shifting siblings twice
          const anim = el.animate(
            [
              { opacity: 0, transform: 'translate3d(0, -6px, 0)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 240,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }
          );
          animationsRef.current.set(key, anim);
          anim.onfinish = () => { if (animationsRef.current.get(key) === anim) animationsRef.current.delete(key); };
          continue;
        }

        const deltaY = startTop - targetTop;
        if (Math.abs(deltaY) < 0.5) {
          continue;
        }

        const isPrimaryMoved =
          movedItemKey === key || Math.abs(deltaY) > 72;

        if (isPrimaryMoved) {
          el.style.zIndex = '20';
          el.style.position = 'relative';
        } else {
          el.style.zIndex = '1';
          el.style.position = 'relative';
        }

        const anim = el.animate(
          [
            { transform: `translate3d(0, ${deltaY}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          {
            duration: 320,
            // Smooth, Critically-Damped Cubic Bezier (no overshoot, no bounce, synchronous block movement)
            easing: 'cubic-bezier(0.25, 1, 0.35, 1)',
          }
        );

        animationsRef.current.set(key, anim);
        const cleanupStyle = () => {
          if (animationsRef.current.get(key) !== anim) return;
          el.style.zIndex = '';
          el.style.position = '';
          animationsRef.current.delete(key);
        };
        anim.onfinish = cleanupStyle;
        anim.oncancel = cleanupStyle;
      }
    }

    prevTopsRef.current = nextTops;
  });

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
