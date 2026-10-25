// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NetworkPlanView } from './NetworkPlanView';
import { TaskState } from '../domain/types';

it('lays out complete same-day dependency levels at responsive widths and across midnight', () => {
  const task = (id: string, day: number, predecessorIds: string[] = []): TaskState => ({
    id, title: id, creationOrder: 0, createdAt: new Date(2026, 9, 10).toISOString(),
    configuredStart: new Date(2026, 9, day, 9).toISOString(), calculatedStart: null,
    effectiveStart: new Date(2026, 9, day, 9).toISOString(), effectiveDateKey: `2026-10-${day}`,
    predecessorIds, allPredecessorIds: predecessorIds, successorIds: [],
    isActive: false, completed: false, isDeemphasized: false,
  });
  // Priority is deliberately not topological. X/Y/Z are independent roots;
  // B/D form a diamond with A, and A->C is redundant through B.
  const tasks = [task('C', 14, ['A', 'B']), task('X', 10), task('A', 10),
    task('Y', 10), task('Z', 10), task('B', 12, ['A']), task('D', 12, ['A']),
    task('E', 14, ['B', 'D']), task('F', 18, ['E'])];
  const noop = vi.fn();
  const editor = { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop };
  const props = {
    openTasks: tasks, now: new Date(2026, 9, 17, 23, 59), deletionPreview: [],
    selectedTaskId: null, selectedEdgeKeys: [], highlights: {}, draggedTaskId: null,
    isAltDrag: false, activeDropTargetKey: null, titleEditor: editor, dateEditor: editor,
    onSelectEdge: noop, onClearEdgeSelection: noop, onClearTaskSelection: noop,
    setActiveDropTargetKey: noop,
    onSelectTask: noop, onContextMenuTask: noop, onDragStartTask: noop,
    onAddPredecessor: noop, onRemoveDependencyBetween: noop, onSetConfiguredDate: noop, onToggleActive: noop,
  };
  let width = 840;
  let resize = () => {};
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const bounds = (id: string) => {
    const node = element.querySelector<HTMLElement>(`[data-task-drag="${id}"]`)!;
    return { x: parseFloat(node.style.left), y: parseFloat(node.style.top),
      width: parseFloat(node.style.width), height: parseFloat(node.style.height) };
  };
  const verifyEdges = () => {
    for (const path of element.querySelectorAll('g[data-edge-key] path[marker-end]')) {
      const [from, to] = path.parentElement!.getAttribute('data-edge-key')!.split('->');
      const source = bounds(from), target = bounds(to);
      const direction = source.y === target.y
        ? { x: target.x > source.x ? 1 : -1, y: 0 }
        : { x: 0, y: target.y > source.y ? 1 : -1 };
      const [x0, y0, x1, y1, x2, y2, x3, y3] = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect([x0, y0]).toEqual([source.x + source.width / 2 + direction.x * source.width / 2,
        source.y + source.height / 2 + direction.y * source.height / 2]);
      expect([x3 + direction.x * 8, y3 + direction.y * 8]).toEqual([
        target.x + target.width / 2 - direction.x * target.width / 2,
        target.y + target.height / 2 - direction.y * target.height / 2]);
      if (direction.x === 0) {
        expect(x2).toBe(x3); expect(Math.sign(y3 - y2)).toBe(direction.y);
        expect(Math.sign(y1 - y0)).toBe(direction.y);
        expect(Math.min(y0, y1, y2, y3)).toBeGreaterThanOrEqual(Math.min(source.y + source.height, target.y + target.height));
        expect(Math.max(y0, y1, y2, y3)).toBeLessThanOrEqual(Math.max(source.y, target.y));
      } else {
        expect(y2).toBe(y3); expect(Math.sign(x3 - x2)).toBe(direction.x);
        expect(Math.sign(x1 - x0)).toBe(direction.x);
      }
      for (let i = 1; i <= 1000; i++) {
        const t = i / 1000, u = 1 - t;
        const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
        const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
        for (const node of [source, target]) expect(x > node.x && x < node.x + node.width
          && y > node.y && y < node.y + node.height).toBe(false);
      }
    }
  };
  try {
    act(() => root.render(<NetworkPlanView {...props} />));
    expect(bounds('X').y).toBe(bounds('A').y);
    expect(bounds('X').x).toBeLessThan(bounds('A').x);
    expect(bounds('Y').y).toBe(bounds('Z').y);
    expect(bounds('B').y).toBeGreaterThan(bounds('Z').y + 56);
    expect(bounds('B').y).toBe(bounds('D').y);
    expect(bounds('C').y).toBe(bounds('E').y);
    expect(bounds('C').x).toBeLessThan(bounds('E').x);
    expect(element.querySelector('[data-edge-key="A->C"]')).toBeNull();
    verifyEdges();
    const before = tasks.map(({ id }) => bounds(id));
    act(() => root.render(<NetworkPlanView {...props} deletionPreview={['A->B', 'A->C']} />));
    expect(tasks.map(({ id }) => bounds(id))).toEqual(before);
    expect([...element.querySelectorAll('[data-deletion-preview="true"]')].map(node => node.getAttribute('data-edge-key')).sort())
      .toEqual(['A->B', 'A->C']);
    verifyEdges();
    width = 400;
    act(() => resize());
    expect(new Set(tasks.map(({ id }) => bounds(id).x)).size).toBe(1);
    expect(bounds('B').y).toBeGreaterThan(bounds('Z').y + 56);
    expect(bounds('C').y).toBeGreaterThan(bounds('D').y + 56);
    verifyEdges();
    width = 1200;
    act(() => resize());
    expect(bounds('X').y).toBe(bounds('Z').y);
    verifyEdges();
    act(() => root.render(<NetworkPlanView {...props} now={new Date(2026, 9, 18, 0, 1)} />));
    expect(element.textContent).not.toContain('2026-10-17');
    expect(element.textContent).toContain('2026-10-18');
    expect(bounds('F').y - bounds('E').y).toBe(76);
    verifyEdges();

    const activeTasks = tasks.map(task => ({ ...task, isActive: ['C', 'B', 'F'].includes(task.id) }));
    const activeProps = { ...props, openTasks: activeTasks };
    act(() => root.render(<NetworkPlanView {...activeProps} />));
    // Active priority, not topology: C stays before its active predecessor B.
    expect(bounds('C').y).toBe(bounds('B').y);
    expect(bounds('C').x).toBeLessThan(bounds('B').x);
    expect(bounds('F').y).toBe(bounds('C').y);
    expect(bounds('A').y).toBeGreaterThan(bounds('F').y + 56);
    expect(bounds('E').y).toBeGreaterThan(bounds('D').y + 56);
    expect(element.querySelector('[data-task-drop-target="2026-10-17"]')).not.toBeNull();
    expect(element.querySelector('[data-task-drop-target="2026-10-18"]')).toBeNull();
    expect(element.querySelector('[data-edge-key="A->B"]')).not.toBeNull();
    verifyEdges();
    const flame = element.querySelector<HTMLButtonElement>('[data-task-drag="C"] button')!;
    expect(flame.disabled).toBe(false);
    act(() => flame.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(noop).toHaveBeenLastCalledWith(activeTasks[0]);
    width = 400;
    act(() => resize());
    expect(bounds('C').y).toBeLessThan(bounds('B').y);
    expect(bounds('B').y).toBeLessThan(bounds('F').y);
    expect(bounds('F').y).toBeLessThan(bounds('X').y);
    verifyEdges();
    expect(activeTasks[0].predecessorIds).toEqual(['A', 'B']);
    expect(activeTasks[8].effectiveDateKey).toBe('2026-10-18');
    act(() => root.render(<NetworkPlanView {...activeProps} now={new Date(2026, 9, 18, 0, 1)} />));
    expect(element.textContent).not.toContain('2026-10-17');
    expect(bounds('F').y).toBeLessThan(bounds('X').y);
    verifyEdges();
  } finally {
    act(() => root.unmount()); element.remove(); clientWidth.mockRestore(); vi.unstubAllGlobals();
  }
});
