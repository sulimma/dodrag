// Native OLE drags suppress DOM wheel events; the Windows UI-thread hook forwards them.
export function scrollTaskDragWheel(event: { x: number; y: number; delta: number; horizontal: boolean }) {
  if (![event.x, event.y, event.delta].every(Number.isFinite)) return;
  let element = document.elementFromPoint(event.x, event.y);
  const amount = event.delta / 120 * 100 * (event.horizontal ? 1 : -1);
  while (element) {
    if (!(element instanceof HTMLElement)) {
      element = element.parentElement;
      continue;
    }
    const style = getComputedStyle(element);
    const overflow = event.horizontal ? style.overflowX : style.overflowY;
    const maximum = event.horizontal
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
    const current = event.horizontal ? element.scrollLeft : element.scrollTop;
    if (/^(auto|scroll)$/.test(overflow) && maximum > 0 &&
        (amount < 0 ? current > 0 : current < maximum)) {
      if (event.horizontal) element.scrollLeft = Math.max(0, Math.min(maximum, current + amount));
      else element.scrollTop = Math.max(0, Math.min(maximum, current + amount));
      return;
    }
    element = element.parentElement;
  }
}
