import { useLayoutEffect } from 'react';

// Hide only the initial, unloaded surface. Resizes and mode changes must never
// blank an already visible WebView or wait for a quiet viewport to show it again.
export function useWindowPresentation(ready: boolean): void {
  useLayoutEffect(() => {
    if (!ready) return;
    let disposed = false;
    const reveal = () => {
      if (!disposed) {
        const root = document.getElementById('root');
        if (root) delete root.dataset.windowSettling;
      }
    };
    if (document.fonts) void document.fonts.ready.then(reveal);
    else reveal();
    return () => { disposed = true; };
  }, [ready]);
}

// A DOM commit is not a WebView2 presentation fence. Give a visible WebView a
// complete paint opportunity before changing native geometry (including normal
// content before iconifying mini). Hidden/occluded WebViews may suspend RAF:
// visibility loss and a bounded watchdog guarantee that restore still advances.
// The watchdog is a liveness fallback, not a viewport-settling delay.
export function allowWindowPaint(): Promise<void> {
  if (document.visibilityState === 'hidden') return Promise.resolve();
  return new Promise(resolve => {
    let frame = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      clearTimeout(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      resolve();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
    const watchdog = setTimeout(finish, 100);
    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
  });
}
