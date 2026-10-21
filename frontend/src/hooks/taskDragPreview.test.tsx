// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { taskDragPreview } from './taskDragPreview';
import { useTaskDrag, type DragIdentity } from './useTaskDrag';
import type { TaskState } from '../domain/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const tasks = Object.fromEntries(['A', 'B', 'C'].map(id => [id, { id, title: `<img src=x onerror=alert(1)> ${id}`, completed: false }])) as Record<string, TaskState>;
const node = (id: string, x: number, y: number, width = 200, bar = false) => {
  const element = document.createElement('div');
  element.dataset.taskDrag = id;
  if (bar) element.dataset.ganttNode = id;
  element.style.backgroundColor = 'rgb(12, 34, 56)';
  const title = document.createElement('button');
  title.textContent = tasks[id].title; title.id = `title-${id}`;
  element.appendChild(title);
  element.getBoundingClientRect = () => ({ left: x, top: y, width, height: 40, right: x + width, bottom: y + 40, x, y, toJSON() {} });
  document.body.appendChild(element);
  return element;
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('clones every frozen member with styles, relative positions and scaled non-first-source hotspot', () => {
  node('A', 100, 100, 800); const source = node('B', 140, 180, 800); node('C', 100, 230);
  const setDragImage = vi.fn();
  const cleanup = taskDragPreview({ setDragImage } as unknown as DataTransfer, source, ['A', 'B'], tasks, 160, 190);
  const [image, x, y] = setDragImage.mock.calls[0];
  expect(image.querySelectorAll('[data-drag-preview-task]').length).toBe(2);
  expect(image.textContent).toContain(tasks.A.title);
  expect(image.textContent).toContain(tasks.B.title);
  expect(image.querySelector('img')).toBeNull();
  expect(image.querySelector('[id],[data-task-drag],[draggable],[contenteditable]')).toBeNull();
  expect(image.inert).toBe(true);
  expect(image.querySelector('button').tabIndex).toBe(-1);
  expect(image.querySelector('[data-drag-preview-task="A"]').style.backgroundColor).toBe('rgb(12, 34, 56)');
  const scale = 600 / 840;
  expect(x).toBe(Math.round(60 * scale)); expect(y).toBe(Math.round(90 * scale));
  expect(image.querySelector('[data-drag-preview-task="B"]').style.top).toBe('80px');
  cleanup(); cleanup(); expect(document.querySelector('[data-task-drag-preview]')).toBeNull();
});

it('uses bars for bar drags and keeps distant/offscreen members in a bounded compact preview', () => {
  node('A', 0, 0); node('B', 0, 40);
  const source = node('A', 100, 100, 120, true); node('B', 5000, 9000, 120, true);
  const setDragImage = vi.fn();
  taskDragPreview({ setDragImage } as unknown as DataTransfer, source, ['A', 'B'], tasks, 130, 110);
  const [image, x, y] = setDragImage.mock.calls[0];
  expect(image.querySelector('[data-drag-preview-task="B"]').style.width).toBe('120px');
  expect(parseFloat(image.style.width)).toBeLessThanOrEqual(600);
  expect(parseFloat(image.style.height)).toBeLessThanOrEqual(440);
  expect(image.querySelectorAll('[data-drag-preview-task]').length).toBe(2);
  expect(x).toBe(30); expect(y).toBe(10);
});

it('represents unavailable members separately with literal text, not overlapping the source', () => {
  const source = node('A', 100, 100);
  const setDragImage = vi.fn();
  taskDragPreview({ setDragImage } as unknown as DataTransfer, source, ['A', 'B', 'C'], tasks, 110, 110);
  const image = setDragImage.mock.calls[0][0] as HTMLElement;
  expect(image.querySelector('[data-drag-preview-task="B"]')!.textContent).toBe(`B ${tasks.B.title}`);
  expect(image.querySelector('img')).toBeNull();
  expect(new Set(Array.from(image.querySelectorAll<HTMLElement>('[data-drag-preview-task]')).map(node => node.style.top)).size).toBe(3);
});

it('skips single previews unless requested and removes a preview if setDragImage throws', () => {
  const source = node('A', 100, 100); node('B', 100, 150);
  const setDragImage = vi.fn(() => { throw new Error('test'); });
  taskDragPreview({ setDragImage } as unknown as DataTransfer, source, ['A'], tasks, 110, 110)();
  expect(setDragImage).not.toHaveBeenCalled();
  expect(() => taskDragPreview({ setDragImage } as unknown as DataTransfer, source, ['A', 'B'], tasks, 110, 110)).toThrow('test');
  expect(document.querySelector('[data-task-drag-preview]')).toBeNull();
});

it.each(['pointercancel', 'drop', 'blur', 'Escape', 'unmount'])('cleans the pointer preview on %s after the drop handler consumes identity', async end => {
  const source = node('A', 100, 100); node('B', 100, 150);
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const identity = { current: null } as React.MutableRefObject<DragIdentity | null>;
  const consumed = vi.fn();
  let actions!: ReturnType<typeof useTaskDrag>;
  function Harness() {
    actions = useTaskDrag({ mutationBusy: { current: false }, snapshotConfirmed: { current: true }, databaseIdentity: { current: 'test.db' } }, {
      selectedTaskIds: ['A', 'B'], setSelectedTaskId: vi.fn(), clearEdgeSelection: vi.fn(),
    }, tasks, identity);
    return null;
  }
  await act(async () => root.render(<Harness />));
  source.dataset.taskDropTarget = 'task:A';
  source.addEventListener('dragstart', event => actions.onDragStartTask({ currentTarget: source,
    clientX: 110, clientY: 110, dataTransfer: (event as DragEvent).dataTransfer } as unknown as React.DragEvent, 'A'));
  source.addEventListener('drop', () => consumed(identity.current?.taskIds));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => source });
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 110 });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    source.dispatchEvent(event);
  };
  await act(async () => { pointer('pointerdown', 100); pointer('pointermove', 110); });
  expect(document.querySelector('[data-task-drag-preview]')).not.toBeNull();
  await act(async () => {
    if (end === 'unmount') root.unmount();
    else if (end === 'drop') pointer('pointerup', 110);
    else if (end === 'pointercancel') pointer('pointercancel', 110);
    else window.dispatchEvent(end === 'Escape' ? new KeyboardEvent('keydown', { key: 'Escape' }) : new Event(end));
  });
  expect(document.querySelector('[data-task-drag-preview]')).toBeNull();
  if (end === 'drop') expect(consumed).toHaveBeenCalledWith(['A', 'B']);
  else expect(consumed).not.toHaveBeenCalled();
  expect(identity.current).toBeNull();
  if (end !== 'unmount') await act(async () => root.unmount());
  delete (document as Partial<Document>).elementFromPoint;
});
