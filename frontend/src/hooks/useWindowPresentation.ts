import { useLayoutEffect, useRef } from 'react';

// Native geometry and React mode confirmations travel separately. Keep the root
// laid out but invisible until loading/fonts and a quiet viewport agree. No
// transition runs on ordinary user resizing after the surface has been revealed.
export function useWindowPresentation(ready: boolean, mode: string): () => Promise<() => void> {
  const controller = useRef({ ready, pending: 0, frame: 0, disposed: false, settle: () => {} });
  controller.current.ready = ready;
  useLayoutEffect(() => {
    const state = controller.current;
    state.disposed = false;
    const root = document.getElementById('root');
    if (!root) return;
    let fontsReady = !document.fonts;
    let width = window.innerWidth, height = window.innerHeight, stableSince = performance.now();
    const tick = () => {
      state.frame = 0;
      if (state.disposed || !state.ready || state.pending) return;
      if (width !== window.innerWidth || height !== window.innerHeight) {
        width = window.innerWidth; height = window.innerHeight; stableSince = performance.now();
      }
      if (fontsReady && performance.now() - stableSince >= 100) {
        delete root.dataset.windowSettling;
      } else state.frame = requestAnimationFrame(tick);
    };
    state.settle = () => {
      // Readiness/confirmation callbacks may arrive after reveal. They must
      // never start another blank phase; only an explicit transition can hide.
      if (!root.dataset.windowSettling) return;
      stableSince = performance.now();
      cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(tick);
    };
    const resize = () => { if (root.dataset.windowSettling) state.settle(); };
    window.addEventListener('resize', resize);
    state.settle();
    void document.fonts?.ready.then(() => { if (!state.disposed) { fontsReady = true; state.settle(); } });
    return () => {
      state.disposed = true;
      cancelAnimationFrame(state.frame);
      window.removeEventListener('resize', resize);
    };
  }, [ready, mode]);
  return async () => {
    const state = controller.current;
    state.pending++;
    const root = document.getElementById('root');
    if (root) {
      const alreadyHidden = !!root.dataset.windowSettling;
      root.dataset.windowSettling = 'true';
      // Commit a hidden browser frame before Win32 changes/restores the HWND.
      // Otherwise WebView2 can briefly present its previous visible surface.
      // An iconic WebView can suspend RAF entirely. Its hidden/previously
      // hidden surface needs no extra paint before native restoration.
      if (!alreadyHidden && mode !== 'taskbar' && document.visibilityState !== 'hidden') {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
    }
    return () => { state.pending--; if (!state.disposed) state.settle(); };
  };
}
