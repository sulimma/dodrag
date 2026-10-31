// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { allowWindowPaint, useWindowPresentation } from './useWindowPresentation';

it('reveals after startup and never suspends presentation on resize or rerender', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = document.createElement('div');
  element.id = 'root'; element.dataset.windowSettling = 'true'; document.body.append(element);
  const root = createRoot(element);
  function Harness({ ready }: { ready: boolean }) { useWindowPresentation(ready); return null; }
  try {
    await act(async () => root.render(<Harness ready={false} />));
    expect(element.dataset.windowSettling).toBe('true');
    await act(async () => root.render(<Harness ready />));
    expect(element.dataset.windowSettling).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      root.render(<Harness ready />);
    });
    expect(element.dataset.windowSettling).toBeUndefined();
  } finally { act(() => root.unmount()); element.remove(); vi.unstubAllGlobals(); }
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('allows two visible frame callbacks before native geometry may change', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  let complete = false;
  const paint = allowWindowPaint().then(() => { complete = true; });
  expect(complete).toBe(false);
  frames[0](0); await Promise.resolve();
  expect(complete).toBe(false);
  frames[1](16); await paint;
  expect(complete).toBe(true);
});

it('does not wait for a hidden WebView frame', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const frame = vi.spyOn(window, 'requestAnimationFrame');
  await allowWindowPaint();
  expect(frame).not.toHaveBeenCalled();
});

it('advances restore when visible WebView animation frames are suspended', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const paint = allowWindowPaint();
  await vi.runAllTimersAsync();
  await paint;
  expect(vi.getTimerCount()).toBe(0);
});

it('stops waiting when the document becomes hidden during a transition', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const paint = allowWindowPaint();
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await paint;
  expect(vi.getTimerCount()).toBe(0);
});
