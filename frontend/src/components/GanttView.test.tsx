// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { GanttView } from './GanttView';
import { NetworkPlanView } from './NetworkPlanView';
import { ListView } from './ListView';
import { localDate } from '../domain/dates';
import { formatIso8601Display } from '../domain/projector';
import { TaskState } from '../domain/types';

it('places incoming edges from further left lower, then orders equal-column sources by row', () => {
  const task = (id: string, day: number, predecessorIds: string[] = []): TaskState => ({
    id, title: id, creationOrder: 0,
    description: '', logEntries: [], checklistProgress: null,
    createdAt: '2026-10-17T12:00:00Z',
    configuredStart: localDate(2026, 10, day, 14, 30, 12).toISOString(),
    calculatedStart: null,
    effectiveStart: `2026-10-${day}T12:00:00Z`,
    effectiveDateKey: `2026-10-${day}`,
    predecessorIds, allPredecessorIds: predecessorIds, successorIds: [],
    isActive: false, completed: false, isDeemphasized: false,
  });
  const tasks = [
    task('left-upper', 17),
    task('near', 18),
    task('left-lower', 17),
    task('target', 19, ['left-upper', 'near', 'left-lower']),
    task('other', 19, ['left-upper']),
  ];
  const noop = vi.fn();
  const element = document.createElement('div');
  const props = {
    openTasks: tasks,
    listEntries: tasks.map(task => ({ kind: 'task' as const, key: task.id, task })),
    now: new Date(2026, 9, 17, 12),
    deletionPreview: [], selectedTaskId: null, selectedEdgeKeys: [], highlights: {},
    draggedTaskId: null, isAltDrag: false, activeDropTargetKey: null,
    titleEditor: { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop },
    dateEditor: { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop },
    onSelectEdge: noop, onClearEdgeSelection: noop, onClearTaskSelection: noop,
    setActiveDropTargetKey: noop, onSelectTask: noop,
    onContextMenuTask: noop, onDragStartTask: noop,
    onAddPredecessor: noop, onRemoveDependencyBetween: noop,
    onSetConfiguredDate: noop, onToggleActive: noop,
  };
  element.innerHTML = renderToStaticMarkup(<GanttView {...props} />);
  const points = (key: string) => element.querySelector(`[data-edge-key="${key}"] path`)!
    .getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const upper = points('left-upper->target');
  const near = points('near->target');
  const lower = points('left-lower->target');
  const other = points('left-upper->other');
  const endY = (p: number[]) => p[p.length - 1];
  expect(endY(near)).toBeLessThan(endY(upper));
  expect(endY(upper)).toBeLessThan(endY(lower));
  // Existing outgoing Y order and vertical lane X order stay intact.
  expect(upper[1]).toBeLessThan(other[1]);
  expect(upper[4]).toBeGreaterThan(lower[4]);
  expect(lower[4]).toBeGreaterThan(other[4]);
  expect(element.querySelector('[data-gantt-node="target"]')!.getAttribute('title')).toContain('target: target (2026-10-19)');
  const networkMarkup = renderToStaticMarkup(<NetworkPlanView {...props} />);
  expect(networkMarkup).toContain('2026-10-19');
  element.innerHTML = networkMarkup;
  expect(element.textContent).not.toContain('14:30');
  expect(element.querySelector('button[aria-label="Startdatum target bearbeiten"]')).not.toBeNull();
  expect(formatIso8601Display(tasks[3].configuredStart).isoText).toBe('2026-10-19 14:30:12');

  const verifyFlameSlot = (markup: string) => {
    element.innerHTML = markup;
    for (const task of tasks) {
      const rows = element.querySelectorAll(`[data-task-drag="${task.id}"]`);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.getAttribute('data-source-task-id')).toBe(task.id);
    }
    const targetFlame = element.querySelector<HTMLElement>('[data-task-drag="target"] button');
    const rootFlame = element.querySelector<HTMLElement>('[data-task-drag="left-upper"] button');
    expect(targetFlame).not.toBeNull();
    expect(targetFlame!.classList.contains('invisible')).toBe(false);
    expect((targetFlame as HTMLButtonElement).disabled).toBe(false);
    expect(rootFlame).not.toBeNull();
    expect(rootFlame!.classList.contains('invisible')).toBe(false);
  };
  verifyFlameSlot(renderToStaticMarkup(<ListView {...props} listEntries={props.listEntries}
    movedItemKey={null} />));
  verifyFlameSlot(renderToStaticMarkup(<GanttView {...props} />));
  verifyFlameSlot(networkMarkup);

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  document.body.append(element);
  const root = createRoot(element);
  const toggle = vi.fn();
  try {
    for (const view of [<ListView {...props} movedItemKey={null} onToggleActive={toggle} />,
      <GanttView {...props} onToggleActive={toggle} />,
      <NetworkPlanView {...props} onToggleActive={toggle} />]) {
      act(() => root.render(view));
      const flame = element.querySelector<HTMLButtonElement>('[data-task-drag="target"] button')!;
      expect(flame.disabled).toBe(false);
      act(() => flame.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(toggle).toHaveBeenLastCalledWith(tasks[3]);
    }
    expect(toggle).toHaveBeenCalledTimes(3);

    const activeTasks = tasks.map(task => ({ ...task, isActive: ['target', 'other'].includes(task.id) }));
    const activeProps = { ...props, openTasks: activeTasks,
      listEntries: activeTasks.map(task => ({ kind: 'task' as const, key: task.id, task })) };
    act(() => root.render(<GanttView {...activeProps} />));
    const node = (id: string) => element.querySelector<HTMLElement>(`[data-gantt-node="${id}"]`)!;
    expect([...element.querySelectorAll('[data-gantt-list] [data-task-drag]')]
      .map(row => row.getAttribute('data-task-drag'))).toEqual(['target', 'other', 'left-upper', 'near', 'left-lower']);
    expect(node('target').style.left).toBe(node('left-upper').style.left);
    expect(node('other').style.left).toBe(node('left-upper').style.left);
    expect(parseFloat(node('target').style.top)).toBeLessThan(parseFloat(node('left-upper').style.top));
    const backward = points('near->target');
    const [prevX, prevY, endX, endY] = backward.slice(-4);
    expect(endX).toBe(parseFloat(node('target').style.left) + parseFloat(node('target').style.width) + 8);
    expect(prevX).toBeGreaterThan(endX);
    expect(prevY).toBe(endY);
    expect(backward[1]).toBeGreaterThan(endY);
    expect(activeTasks[3].predecessorIds).toEqual(['left-upper', 'near', 'left-lower']);
    expect(activeTasks[3].effectiveDateKey).toBe('2026-10-19');
  } finally {
    act(() => root.unmount()); element.remove(); vi.unstubAllGlobals();
  }
});
