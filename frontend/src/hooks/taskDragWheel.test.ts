// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { scrollTaskDragWheel } from './taskDragWheel';

it('scrolls the area under the drag, chains at edges and handles horizontal wheels', () => {
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  const task = document.createElement('span');
  outer.style.overflowY = inner.style.overflowY = 'auto';
  outer.style.overflowX = 'auto';
  inner.append(task); outer.append(inner); document.body.append(outer);
  for (const element of [inner, outer]) {
    Object.defineProperties(element, {
      scrollHeight: { value: 1000 }, clientHeight: { value: 200 },
      scrollWidth: { value: 600 }, clientWidth: { value: 200 },
    });
  }
  const hit = vi.fn(() => task);
  vi.stubGlobal('document', document);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  try {
    const wheel = { x: 30, y: 40, delta: -120, horizontal: false };
    scrollTaskDragWheel(wheel);
    expect(inner.scrollTop).toBe(100); expect(outer.scrollTop).toBe(0);
    inner.scrollTop = 800;
    scrollTaskDragWheel(wheel);
    expect(outer.scrollTop).toBe(100);
    scrollTaskDragWheel({ ...wheel, delta: 60 });
    expect(inner.scrollTop).toBe(750);
    scrollTaskDragWheel({ ...wheel, delta: 120, horizontal: true });
    expect(outer.scrollLeft).toBe(100);
    scrollTaskDragWheel({ ...wheel, delta: NaN });
    expect(inner.scrollTop).toBe(750);
    expect(hit).toHaveBeenCalledWith(30, 40);
  } finally {
    outer.remove(); delete (document as Partial<Document>).elementFromPoint; vi.unstubAllGlobals();
  }
});
