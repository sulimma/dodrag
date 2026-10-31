// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DateScrollOverlay } from './DateScrollOverlay';

it.each([false, true])('tracks dates, preserves originals and drops, and handles removed dates (fixed offsets: %s)', fixed => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), drop = vi.fn();
  let scroll: HTMLElement = host;
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-content') ? -scroll.scrollTop
      : this.hasAttribute('data-date-divider') ? Number(this.dataset.offset) - scroll.scrollTop : 0;
    return { top, left: 0, width: 800, height: 500, bottom: top + 500, right: 800, x: 0, y: top, toJSON: () => ({}) };
  });
  function View({ keys }: { keys: string[] }) {
    const scrollRef = useRef<HTMLDivElement | null>(null), contentRef = useRef<HTMLDivElement>(null);
    return <div ref={node => { scrollRef.current = node; if (node) scroll = node; }}>
      <div ref={contentRef} data-content>
        {keys.map((key, i) => <div key={key} data-date-divider={key} data-offset={20 + i * 100}>{key}</div>)}
        <DateScrollOverlay scrollRef={scrollRef} contentRef={contentRef}
          dates={keys.map((dateKey, i) => ({ dateKey, offset: fixed ? 20 + i * 100 : undefined }))}
          height={40} renderDate={key => <div onDrop={() => drop(key)}>{key}</div>} />
      </div>
    </div>;
  }
  const render = (keys: string[]) => act(() => root.render(<View keys={keys} />));
  const move = (top: number) => act(() => { scroll.scrollTop = top; scroll.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });
  const overlay = () => host.querySelector<HTMLElement>('[data-date-context]');
  try {
    render(['a', 'b']); expect(overlay()).toBeNull();
    move(30); const original = overlay()!;
    expect(original.textContent).toBe('a'); expect(scroll.contains(original)).toBe(false);
    expect(scroll.querySelectorAll('[data-date-divider]')).toHaveLength(2);
    move(100); expect(overlay()).toBe(original); expect(original.style.transform).toBe('translateY(-20px)');
    move(120); expect(overlay()!.textContent).toBe('b');
    act(() => overlay()!.firstElementChild!.dispatchEvent(new Event('drop', { bubbles: true })));
    expect(drop).toHaveBeenCalledWith('b');
    render(['a']); expect(overlay()!.textContent).toBe('a');
    render([]); expect(overlay()).toBeNull();
  } finally {
    act(() => root.unmount()); host.remove(); rect.mockRestore(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
