import { useLayoutEffect, useRef } from 'react';

// Native geometry and React mode confirmations travel separately. Keep the root
// laid out but invisible until loading/fonts and a quiet viewport agree. No
// transition runs on ordinary user resizing after the surface has been revealed.
export function useWindowPresentation(ready: boolean, mode: string): () => () => void {
  const controller = useRef({ ready, pending: 0, frame: 0, disposed: false, settle: () => {} });
  controller.current.ready = ready;
  useLayoutEffect(() => {
    const state = controller.current;
    state.disposed = false;
    const root = document.getElementById('root');
    if (!root) return;
    let fontsReady = !document.fonts;
    let width = window.innerWidth, height = window.innerHeight, stableSince = performance.now();
    const hide = () => { root.dataset.windowSettling = 'true'; };
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
      hide(); stableSince = performance.now();
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
  return () => {
    const state = controller.current;
    state.pending++;
    const root = document.getElementById('root');
    if (root) root.dataset.windowSettling = 'true';
    return () => { state.pending--; if (!state.disposed) state.settle(); };
  };
}
