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
    setActiveDropTargetKey: noop, onDragEndTask: noop };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const render = () => act(() => root.render(<TaskSidebar tasks={state.tasks}
    completedTasks={state.completedTasks} now={now} interactions={interactions}
    onCompleteTask={noop} onResubmitTasks={noop} onReopenTask={noop} />));
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
  } finally {
    act(() => root.unmount()); element.remove(); height.mockRestore(); vi.unstubAllGlobals();
  }
});
