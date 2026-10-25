// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskSidebar } from './TaskSidebar';
import { projectEvents } from '../domain/projector';
import type { StoredEvent } from '../domain/types';

it('orders completions by instant, separates local days and scrolls to the newest completion', () => {
  const now = new Date(2027, 0, 2, 12);
  let events: StoredEvent[] = [];
  const append = (command: Pick<StoredEvent, 'type' | 'payload'>) => {
    events = [...events, { ...command, seq: events.length + 1, id: `e${events.length}`,
      timestamp: now.toISOString(), undone: false } as StoredEvent];
  };
  // Start dates and insertion order deliberately disagree with completion order.
  for (const [taskId, day] of [['A', 1], ['C', 2], ['B', 3]] as const) {
    append({ type: 'TASK_CREATED', payload: { taskId, title: taskId,
      configuredStart: new Date(2026, 11, day).toISOString(), createdAt: now.toISOString() } });
  }
  const early = new Date(2026, 11, 31, 23, 59).toISOString();
  const late = new Date(2027, 0, 1, 0, 1).toISOString();
  append({ type: 'TASK_COMPLETED', payload: { taskId: 'A', completedAt: late } });
  append({ type: 'TASK_COMPLETED', payload: { taskId: 'C', completedAt: late } });
  append({ type: 'TASK_COMPLETED', payload: { taskId: 'B', completedAt: early } });
  let state = projectEvents(events, now);
  expect(state.completedTasks.map(task => task.id)).toEqual(['B', 'A', 'C']);
  const noop = vi.fn();
  const interactions = { selectedTaskId: null, activeDropTargetKey: null, draggedTaskId: null,
    setActiveDropTargetKey: noop, onDragStartTask: noop, onAddPredecessor: noop,
    onRemoveDependencyBetween: noop, onContextMenuTask: noop };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const render = () => act(() => root.render(<TaskSidebar tasks={state.tasks}
    completedTasks={state.completedTasks} now={now} interactions={interactions}
    onCompleteTask={noop} onResubmitTasks={noop} />));
  try {
    render();
    const container = element.querySelector<HTMLElement>('.overflow-y-auto')!;
    expect(container.scrollTop).toBe(900);
    expect([...container.querySelectorAll('.font-mono')].map(node => node.textContent?.trim()))
      .toEqual(['2026-12-31', 'B', '2027-01-01', 'A', 'C']);
    // Reprojection (e.g. selection, clock or language updates) must not force a scroll.
    container.scrollTop = 25;
    state = projectEvents(events, now);
    render();
    expect(container.scrollTop).toBe(25);
    append({ type: 'TASK_REOPENED', payload: { taskId: 'B' } });
    append({ type: 'TASK_COMPLETED', payload: { taskId: 'B', completedAt: now.toISOString() } });
    state = projectEvents(events, now);
    height.mockReturnValue(1100);
    render();
    expect(state.completedTasks.map(task => task.id)).toEqual(['A', 'C', 'B']);
    expect(container.scrollTop).toBe(1100);
    expect(container.textContent).not.toContain('2026-12-31');
    expect(container.textContent).toContain('2027-01-02');
    const completedRow = element.querySelector<HTMLElement>('[data-completed-task="A"]')!;
    expect(completedRow.getAttribute('data-task-drag')).toBe('A');
    expect(completedRow.querySelector('[data-task-selectable-text]')).not.toBeNull();
  } finally {
    act(() => root.unmount()); element.remove(); height.mockRestore(); vi.unstubAllGlobals();
  }
});

it('anchors a visible bottom on resize, keeps a hidden bottom stationary and caps short lists at the top', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const contentHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  const viewportHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const noop = vi.fn();
  try {
    act(() => root.render(<TaskSidebar tasks={{}} completedTasks={[]} now={new Date(2027, 0, 2, 12)}
      interactions={{ selectedTaskId: null, activeDropTargetKey: null, draggedTaskId: null,
        setActiveDropTargetKey: noop, onDragStartTask: noop, onAddPredecessor: noop,
        onRemoveDependencyBetween: noop, onContextMenuTask: noop }}
      onCompleteTask={noop} onResubmitTasks={noop} />));
    const container = element.querySelector<HTMLElement>('.overflow-y-auto')!;
    const scroll = (top: number) => { container.scrollTop = top; container.dispatchEvent(new Event('scroll')); };
    scroll(700);
    viewportHeight.mockReturnValue(200);
    // Browser may dispatch resize-induced scroll before the observer notification.
    container.dispatchEvent(new Event('scroll'));
    resize(); expect(container.scrollTop).toBe(800);
    viewportHeight.mockReturnValue(400);
    resize(); expect(container.scrollTop).toBe(600);
    scroll(250);
    viewportHeight.mockReturnValue(300);
    resize(); expect(container.scrollTop).toBe(250);
    viewportHeight.mockReturnValue(600);
    resize(); expect(container.scrollTop).toBe(250);
    // Growing exposes the bottom; further resizes must now follow it.
    viewportHeight.mockReturnValue(750);
    resize(); expect(container.scrollTop).toBe(250);
    viewportHeight.mockReturnValue(800);
    resize(); expect(container.scrollTop).toBe(200);
    viewportHeight.mockReturnValue(1200);
    resize(); expect(container.scrollTop).toBe(0);
    viewportHeight.mockReturnValue(1500);
    resize(); expect(container.scrollTop).toBe(0);
    viewportHeight.mockReturnValue(500);
    resize(); expect(container.scrollTop).toBe(500);
    // Manually leaving the bottom disables anchoring again.
    scroll(0);
    viewportHeight.mockReturnValue(400);
    resize(); expect(container.scrollTop).toBe(0);
  } finally {
    act(() => root.unmount()); element.remove(); contentHeight.mockRestore(); viewportHeight.mockRestore();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
