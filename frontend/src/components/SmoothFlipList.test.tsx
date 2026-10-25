// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SmoothFlipList } from './SmoothFlipList';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])('animates the restored position after deactivation (reduced motion=%s)', reduced => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: Number(this.dataset.top ?? 0) } as DOMRect;
  });
  const animate = vi.fn(() => ({ cancel: vi.fn(), playState: 'finished', onfinish: null, oncancel: null }));
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    const rows = (active: boolean) => <SmoothFlipList movedItemKey="task:b">
      <div data-flip-key="task:b" data-top={active ? 0 : 80} />
      <div data-flip-key="task:a" data-top={active ? 80 : 0} />
    </SmoothFlipList>;
    act(() => root.render(rows(true)));
    act(() => root.render(rows(false)));
    if (reduced) expect(animate).not.toHaveBeenCalled();
    else expect(animate).toHaveBeenCalledWith([
      { transform: 'translate3d(0, -80px, 0)' },
      { transform: 'translate3d(0, 0, 0)' },
    ], { duration: 320, easing: 'cubic-bezier(0.25, 1, 0.35, 1)' });
  } finally { act(() => root.unmount()); container.remove(); HTMLElement.prototype.animate = original; }
});
