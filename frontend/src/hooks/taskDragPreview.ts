import type { TaskState } from '../domain/types';

// Chromium snapshots this attached, offscreen stacking context after dragstart.
// Do not hide/remove it before then, or use a viewport-clipped ancestor.
export function taskDragPreview(
  transfer: DataTransfer,
  source: HTMLElement,
  taskIds: readonly string[],
  tasks: Record<string, TaskState>,
  clientX: number,
  clientY: number
) {
  if (taskIds.length < 2) return () => {};
  const bars = source.hasAttribute('data-gantt-node');
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(
    bars ? '[data-gantt-node]' : '[data-task-drag]:not([data-gantt-node])'
  ));
  const sourceRect = source.getBoundingClientRect();
  let fallbackY = Math.max(sourceRect.bottom, ...nodes.map(node => node.getBoundingClientRect().bottom)) + 8;
  const items = taskIds.map(id => {
    const matchingNode = nodes.find(element => element.dataset.taskDrag === id);
    const node = matchingNode ?? source;
    const rect = node.getBoundingClientRect();
    const clone = node.cloneNode(true) as HTMLElement;
    const originals = [node, ...Array.from(node.querySelectorAll('*'))];
    const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
    copies.forEach((copy, index) => {
      const original = originals[index];
      const style = getComputedStyle(original);
      const target = (copy as HTMLElement | SVGElement).style;
      for (const property of Array.from(style)) target.setProperty(property, style.getPropertyValue(property));
      for (const attribute of Array.from(copy.attributes)) {
        if (/^(?:id|name|tabindex|autofocus|contenteditable|draggable|href|aria-.*|data-.*|on.*)$/i.test(attribute.name)) {
          copy.removeAttribute(attribute.name);
        }
      }
      target.setProperty('pointer-events', 'none');
      target.setProperty('user-select', 'none');
      target.setProperty('transition', 'none');
      target.setProperty('animation', 'none');
      if (copy.matches('input,textarea,select,button,a')) copy.setAttribute('tabindex', '-1');
    });
    clone.querySelectorAll('script,iframe,object,embed').forEach(element => element.remove());
    if (!matchingNode) clone.textContent = `${id} ${tasks[id]?.title ?? ''}`;
    clone.dataset.dragPreviewTask = id;
    Object.assign(clone.style, {
      position: 'absolute', margin: '0', width: `${rect.width}px`, height: `${rect.height}px`,
      boxSizing: 'border-box', transform: 'none', opacity: '1', overflow: 'hidden',
    });
    const y = matchingNode ? rect.top : fallbackY;
    if (!matchingNode) fallbackY += rect.height + 8;
    return { id, clone, x: rect.left, y, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  });
  let left = Math.min(...items.map(item => item.x));
  let top = Math.min(...items.map(item => item.y));
  let width = Math.max(...items.map(item => item.x + item.width)) - left;
  let height = Math.max(...items.map(item => item.y + item.height)) - top;
  // Bound CSS and physical pixels, including high-DPI displays. Keep every member.
  const maxWidth = Math.min(600, window.innerWidth - 16, 1200 / window.devicePixelRatio);
  const maxHeight = Math.min(440, window.innerHeight - 16, 880 / window.devicePixelRatio);
  if (Math.min(maxWidth / width, maxHeight / height) < 0.35) {
    const cellWidth = Math.max(...items.map(item => item.width)) + 8;
    const cellHeight = Math.max(...items.map(item => item.height)) + 8;
    const columns = Math.max(1, Math.ceil(Math.sqrt(items.length * cellHeight * maxWidth / (cellWidth * maxHeight))));
    items.forEach((item, index) => { item.x = index % columns * cellWidth; item.y = Math.floor(index / columns) * cellHeight; });
    left = top = 0;
    width = Math.max(...items.map(item => item.x + item.width));
    height = Math.max(...items.map(item => item.y + item.height));
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const image = document.createElement('div');
  image.dataset.taskDragPreview = 'true';
  image.setAttribute('aria-hidden', 'true');
  image.inert = true;
  Object.assign(image.style, {
    position: 'fixed', left: '-10000px', top: '0', width: `${Math.ceil(width * scale)}px`,
    height: `${Math.ceil(height * scale)}px`, pointerEvents: 'none', userSelect: 'none',
    overflow: 'hidden', isolation: 'isolate', zIndex: '-1',
  });
  const layout = document.createElement('div');
  Object.assign(layout.style, { position: 'relative', width: `${width}px`, height: `${height}px`, transformOrigin: '0 0', transform: `scale(${scale})` });
  items.forEach(item => {
    item.clone.style.left = `${item.x - left}px`;
    item.clone.style.top = `${item.y - top}px`;
    layout.appendChild(item.clone);
  });
  image.appendChild(layout);
  document.body.appendChild(image);
  const origin = items.find(item => item.id === source.dataset.taskDrag)!;
  const x = Math.round((origin.x - left + Math.max(0, Math.min(sourceRect.width, clientX - sourceRect.left))) * scale);
  const y = Math.round((origin.y - top + Math.max(0, Math.min(sourceRect.height, clientY - sourceRect.top))) * scale);
  try {
    transfer.setDragImage(image, x, y);
  } catch (error) {
    image.remove();
    throw error;
  }
  return () => image.remove();
}
