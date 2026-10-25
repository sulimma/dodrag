// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResizeHandle } from './ResizeHandle';

class FixturePointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

let host: HTMLDivElement, root: Root;
let originalCursor: string, originalSelection: string;
const bubbleListeners: [string, EventListener][] = [];
const watchBubble = (type: string) => {
  const listener = vi.fn(); document.addEventListener(type, listener);
  bubbleListeners.push([type, listener]); return listener;
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('PointerEvent', FixturePointerEvent);
  originalCursor = document.body.style.cursor;
  originalSelection = document.body.style.userSelect;
  document.body.style.cursor = 'crosshair';
  document.body.style.userSelect = 'text';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  for (const [type, listener] of bubbleListeners.splice(0)) document.removeEventListener(type, listener);
  document.body.style.cursor = originalCursor;
  document.body.style.userSelect = originalSelection;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function mount(orientation: 'vertical' | 'horizontal' = 'vertical', direction: 1 | -1 = 1) {
  const change = vi.fn();
  function Harness() {
    const [value, setValue] = useState(200);
    return <ResizeHandle orientation={orientation} label="Resize fixture" value={value}
      limits={() => [100, 300]} direction={direction} onChange={next => { change(next); setValue(next); }} />;
  }
  act(() => root.render(<Harness />));
  return { handle: host.querySelector<HTMLElement>('[role="separator"]')!, change };
}
const pointer = (target: EventTarget, type: string, init: PointerEventInit = {}) => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
};
const key = (target: EventTarget, value: string, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); }); return event;
};
const value = (handle: HTMLElement) => Number(handle.getAttribute('aria-valuenow'));

it.each(['vertical', 'horizontal'] as const)('exposes a focusable, selectable-text %s separator with limits', orientation => {
  const { handle } = mount(orientation);
  expect(handle.tabIndex).toBe(0);
  expect(handle.getAttribute('aria-label')).toBe('Resize fixture');
  expect(handle.getAttribute('aria-orientation')).toBe(orientation);
  expect(handle.getAttribute('aria-valuemin')).toBe('100');
  expect(handle.getAttribute('aria-valuemax')).toBe('300');
  expect(value(handle)).toBe(200);
  expect(handle.getAttribute('data-task-selectable-text')).toBe('true');
  expect(handle.getAttribute('data-resize-handle')).toBe(orientation);
});

it.each([
  ['vertical', 1, 'ArrowRight', 'ArrowLeft', 'ArrowUp'],
  ['horizontal', 1, 'ArrowDown', 'ArrowUp', 'ArrowRight'],
  ['horizontal', -1, 'ArrowUp', 'ArrowDown', 'ArrowLeft'],
] as const)('uses axis arrows, Shift steps and Home/End clamping for %s direction %s', (orientation, direction, higher, lower, unrelated) => {
  const { handle, change } = mount(orientation, direction);
  const bubble = watchBubble('keydown');
  expect(key(handle, higher).defaultPrevented).toBe(true);
  expect(value(handle)).toBe(210);
  key(handle, higher, true); expect(value(handle)).toBe(250);
  key(handle, higher, true); key(handle, higher, true); expect(value(handle)).toBe(300);
  key(handle, lower); expect(value(handle)).toBe(290);
  key(handle, 'Home'); expect(value(handle)).toBe(100);
  key(handle, lower, true); expect(value(handle)).toBe(100);
  key(handle, 'End'); expect(value(handle)).toBe(300);
  expect(bubble).not.toHaveBeenCalled();
  const calls = change.mock.calls.length;
  expect(key(handle, unrelated).defaultPrevented).toBe(false);
  expect(change).toHaveBeenCalledTimes(calls);
  expect(bubble).toHaveBeenCalledOnce();
});

it.each([
  ['vertical', 1, 'clientX', 'clientY', 'col-resize'],
  ['horizontal', -1, 'clientY', 'clientX', 'row-resize'],
] as const)('resizes %s from the initial pointer coordinate on window and clamps both ends', (orientation, direction, axis, otherAxis, cursor) => {
  const { handle, change } = mount(orientation, direction);
  const bubble = watchBubble('pointerdown');
  expect(pointer(handle, 'pointerdown', { pointerId: 7, [axis]: 80 }).defaultPrevented).toBe(true);
  expect(bubble).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(handle);
  expect(document.body.style.cursor).toBe(cursor);
  expect(document.body.style.userSelect).toBe('none');
  expect(handle.hasAttribute('data-resize-dragging')).toBe(true);
  pointer(window, 'pointermove', { pointerId: 8, [axis]: 120 });
  expect(change).not.toHaveBeenCalled();
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 80, [otherAxis]: 999 });
  expect(value(handle)).toBe(200);
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 80 + direction * 35.4 });
  expect(value(handle)).toBe(235);
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 80 + direction * 50 });
  expect(value(handle)).toBe(250);
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 80 + direction * 1000 });
  expect(value(handle)).toBe(300);
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 80 - direction * 1000 });
  expect(value(handle)).toBe(100);
  pointer(window, 'pointerup', { pointerId: 7 });
  expect(value(handle)).toBe(100);
  expect(handle.hasAttribute('data-resize-dragging')).toBe(false);
  expect(document.body.style.cursor).toBe('crosshair');
  expect(document.body.style.userSelect).toBe('text');
  const calls = change.mock.calls.length;
  pointer(window, 'pointermove', { pointerId: 7, [axis]: 90 });
  expect(change).toHaveBeenCalledTimes(calls);
});

it('ignores other pointer releases, cancellation and a second pointerdown during an active gesture', () => {
  const { handle } = mount();
  pointer(handle, 'pointerdown', { pointerId: 7, clientX: 10 });
  pointer(window, 'pointermove', { pointerId: 7, clientX: 60 });
  pointer(handle, 'pointerdown', { pointerId: 8, clientX: 200 });
  pointer(window, 'pointerup', { pointerId: 8 }); pointer(window, 'pointercancel', { pointerId: 8 });
  expect(handle.hasAttribute('data-resize-dragging')).toBe(true);
  expect(value(handle)).toBe(250);
  pointer(window, 'pointermove', { pointerId: 7, clientX: 70 });
  expect(value(handle)).toBe(260);
  pointer(window, 'pointercancel', { pointerId: 7 });
  expect(value(handle)).toBe(200);
  expect(handle.hasAttribute('data-resize-dragging')).toBe(false);
});

it.each(['Escape', 'pointercancel', 'blur'] as const)('reverts %s to the gesture start and removes active listeners', cancellation => {
  const { handle, change } = mount();
  pointer(handle, 'pointerdown', { clientX: 10 });
  pointer(window, 'pointermove', { clientX: 60 }); expect(value(handle)).toBe(250);
  if (cancellation === 'Escape') expect(key(window, 'Escape').defaultPrevented).toBe(true);
  else if (cancellation === 'pointercancel') pointer(window, 'pointercancel');
  else act(() => { window.dispatchEvent(new Event('blur')); });
  expect(value(handle)).toBe(200);
  expect(change).toHaveBeenLastCalledWith(200);
  expect(handle.hasAttribute('data-resize-dragging')).toBe(false);
  expect(document.body.style.cursor).toBe('crosshair');
  expect(document.body.style.userSelect).toBe('text');
  const calls = change.mock.calls.length;
  pointer(window, 'pointermove', { clientX: 99 }); pointer(window, 'pointercancel'); key(window, 'Escape');
  expect(change).toHaveBeenCalledTimes(calls);
  pointer(handle, 'pointerdown', { clientX: 10 });
  pointer(window, 'pointermove', { clientX: 30 }); pointer(window, 'pointerup');
  expect(value(handle)).toBe(220);
});

it('ignores secondary mouse buttons and suppresses context menus without starting a drag', () => {
  const { handle, change } = mount();
  expect(pointer(handle, 'pointerdown', { button: 2 }).defaultPrevented).toBe(false);
  pointer(window, 'pointermove', { clientX: 100 });
  expect(change).not.toHaveBeenCalled();
  expect(handle.hasAttribute('data-resize-dragging')).toBe(false);
  const bubble = watchBubble('contextmenu');
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  act(() => { handle.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true); expect(bubble).not.toHaveBeenCalled();
});

it.each(['vertical', 'horizontal'] as const)('restores body styles and detaches gesture listeners when unmounted during %s resize', orientation => {
  const { handle, change } = mount(orientation);
  const remove = vi.spyOn(window, 'removeEventListener');
  pointer(handle, 'pointerdown');
  act(() => root.render(null));
  expect(document.body.style.cursor).toBe('crosshair');
  expect(document.body.style.userSelect).toBe('text');
  for (const event of ['pointermove', 'pointerup', 'pointercancel', 'blur']) {
    expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
  }
  expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  pointer(window, 'pointermove', { clientX: 20, clientY: 20 });
  pointer(window, 'pointercancel'); key(window, 'Escape');
  expect(change).not.toHaveBeenCalled();
});
