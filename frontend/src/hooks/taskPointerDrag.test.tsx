// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTaskDrag, type DragIdentity } from './useTaskDrag';
import { taskInteractions } from '../components/taskInteractions';
import type { TaskState } from '../domain/types';

it('reuses drop targeting for movement, scroll, resize and release across repeated pointer drags', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const identity = { current: null } as React.MutableRefObject<DragIdentity | null>;
  const tasks = Object.fromEntries(['A', 'B', 'C'].map(id => [id, { id, title: id, completed: false }])) as Record<string, TaskState>;
  const add = vi.fn(), remove = vi.fn(), resubmit = vi.fn(), selected = vi.fn();
  let actions!: ReturnType<typeof useTaskDrag>;
  function Harness() {
    actions = useTaskDrag({ mutationBusy: { current: false }, snapshotConfirmed: { current: true },
      databaseIdentity: { current: 'test.db' } }, { selectedTaskIds: ['A', 'B'],
      setSelectedTaskId: selected, clearEdgeSelection: vi.fn() }, tasks, identity);
    const interactions = { ...actions, onSelectTask: selected, onContextMenuTask: vi.fn(),
      onAddPredecessor: add, onRemoveDependencyBetween: remove };
    return <>{['A', 'B', 'C'].map(id => <div key={id} {...taskInteractions(id, `task:${id}`, interactions)}>
      <span data-drag-handle>{id}</span><span data-title data-task-selectable-text>{id}</span>
    </div>)}<div data-task-drop-target="resubmit" onDragOver={e => {
      e.preventDefault(); actions.setActiveDropTargetKey('resubmit');
    }} onDrop={() => { resubmit(identity.current?.taskIds); actions.onDragEndTask(); }} /></>;
  }
  const pointer = (target: Element, type: string, x: number, altKey = false) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20, button: 0, altKey });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    act(() => target.dispatchEvent(event));
    return event;
  };
  try {
    act(() => root.render(<Harness />));
    const source = host.querySelector<HTMLElement>('[data-task-drag="A"]')!;
    const handle = source.querySelector('[data-drag-handle]')!;
    let hit: Element | null = host.querySelector('[data-task-drag="B"]');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) });
    // Text selection does not turn into a task drag.
    pointer(source.querySelector('[data-title]')!, 'pointerdown', 10);
    pointer(source, 'pointermove', 30);
    expect(identity.current).toBeNull();
    pointer(handle, 'pointerdown', 10);
    pointer(source, 'pointermove', 12);
    expect(identity.current).toBeNull();
    pointer(source, 'pointermove', 30);
    expect(identity.current?.taskIds).toEqual(['A', 'B']);
    expect(actions.activeDropTargetKey).toBe('task:B');
    expect(document.querySelectorAll('[data-drag-preview-task]').length).toBe(2);
    // Wheel is neither consumed nor converted into custom scrolling.
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    act(() => hit!.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(false);
    hit = host.querySelector('[data-task-drag="C"]');
    act(() => host.dispatchEvent(new Event('scroll')));
    expect(actions.activeDropTargetKey).toBe('task:C');
    hit = host.querySelector('[data-task-drag="B"]');
    act(() => window.dispatchEvent(new Event('resize')));
    expect(actions.activeDropTargetKey).toBe('task:B');
    // Release must re-hit-test even if no movement/scroll event was delivered.
    hit = host.querySelector('[data-task-drag="C"]');
    pointer(source, 'pointerup', 30, true);
    expect(remove).toHaveBeenCalledWith('A', 'C'); expect(add).not.toHaveBeenCalled();
    expect(identity.current).toBeNull();
    expect(document.querySelector('[data-task-drag-preview]')).toBeNull();
    // The pointerup click must not change task selection.
    act(() => source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(selected).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', 10); pointer(source, 'pointermove', 30);
    hit = host.querySelector('[data-task-drop-target="resubmit"]');
    pointer(source, 'pointerup', 30);
    expect(resubmit).toHaveBeenCalledWith(['A', 'B']);
    pointer(handle, 'pointerdown', 10); pointer(source, 'pointermove', 30);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    pointer(source, 'pointerup', 30);
    expect(resubmit).toHaveBeenCalledTimes(1);
    expect(identity.current).toBeNull();
  } finally {
    act(() => root.unmount()); host.remove();
    delete (document as Partial<Document>).elementFromPoint; vi.unstubAllGlobals();
  }
});
