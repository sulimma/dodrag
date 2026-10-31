// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWindowPresentation } from './useWindowPresentation';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.restoreAllMocks());

it.each(['window', 'taskbar'])('waits for paint only on a visible surface (mode=%s)', async mode => {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const element = document.createElement('div'); element.id = 'root'; document.body.append(element);
  const root = createRoot(element);
  let suspend!: () => Promise<() => void>;
  function Harness() { suspend = useWindowPresentation(true, mode); return null; }
  try {
    act(() => root.render(<Harness />));
    let finished = false;
    const operation = suspend().then(finish => { finished = true; return finish; });
    await Promise.resolve();
    if (mode === 'window') {
      expect(finished).toBe(false);
      callbacks.shift()!(0);
      await Promise.resolve();
      expect(finished).toBe(false);
      callbacks.shift()!(16);
    }
    const finish = await operation;
    expect(finished).toBe(true);
    finish();
  } finally { act(() => root.unmount()); element.remove(); }
});
