// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { layoutNetworkLanes } from './networkLanes';
import { NetworkPlanView } from './NetworkPlanView';
import { TaskState } from '../domain/types';

const task = (id: string, day: number, predecessorIds: string[] = []): TaskState => ({
    id, title: id, creationOrder: 0, topologyLevel: 0, createdAt: new Date(2026, 9, 10).toISOString(),
    description: '', logEntries: [], checklistProgress: null, duration: 1, durationUnit: 'days', progress: null,
    configuredStart: new Date(2026, 9, day, 9).toISOString(), calculatedStart: null,
    effectiveStart: new Date(2026, 9, day, 9).toISOString(), effectiveDateKey: `2026-10-${day}`,
    predecessorIds, allPredecessorIds: predecessorIds, successorIds: [],
    isActive: false, completed: false, isDeemphasized: false,
  });
it('straightens a long dependency across sparse time ranges even when it already has no crossings', () => {
  const endpoints = (ids: string[], day: number) => ids.map((id, creationOrder) =>
    ({ ...task(id, day), creationOrder }));
  const bands = [
    endpoints(['a', 'b', 'c', 'd', '230'], 18),
    [task('middle-a', 19)], [task('middle-b', 20)], [task('middle-c', 21)],
    endpoints(['112', 'e', 'f', 'g', 'h'], 22),
  ];
  const edges = [{ from: '230', to: '112' }];
  const rows = layoutNetworkLanes(bands, 5, edges, () => 0).flat(2);
  const lane = (id: string) => rows.find(card => card.task.id === id)!.lane;
  expect(lane('230')).toBe(lane('112'));
});

it.each(['source', 'sink'] as const)('packs a partial lane of %s cards against the matching boundary', role => {
  const band = ['p', 'q', 'r', 'u', 'v'].map(id => task(id, 18));
  const external = task('external', role === 'source' ? 19 : 17);
  const bands = role === 'source' ? [band, [external]] : [[external], band];
  const edges = ['u', 'v'].map(id => role === 'source'
    ? { from: id, to: external.id } : { from: external.id, to: id });
  const areas = layoutNetworkLanes(bands, 2, edges, item => ['u', 'v'].includes(item.id) ? 1 : 0);
  const rows = areas[role === 'source' ? 0 : 1];
  const occupied = rows.flatMap((row, index) =>
    row.filter(card => ['u', 'v'].includes(card.task.id)).map(card => ({ row: index, lane: card.lane })));
  expect(new Set(occupied.map(card => card.lane)).size).toBe(1);
  expect(occupied.map(card => card.row)).toEqual(role === 'source' ? [1, 2] : [0, 1]);
});

it('lays out time ranges independently of manual order at responsive widths and across midnight', () => {
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
      const sameRow = source.y === target.y;
      const between = [...element.querySelectorAll<HTMLElement>('[data-task-drag]')]
        .map(card => bounds(card.dataset.taskDrag!)).filter(card => sameRow && card.y === source.y
          && card.x > Math.min(source.x, target.x) && card.x < Math.max(source.x, target.x));
      const arch = between.length > 0;
      const endDirection = sameRow && !arch
        ? { x: Math.sign(target.x - source.x), y: 0 }
        : { x: 0, y: arch ? 1 : Math.sign(target.y - source.y) };
      const startDirection = arch ? { x: 0, y: -1 } : endDirection;
      const [x0, y0, x1, y1, x2, y2, x3, y3] = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(x0).toBeCloseTo(source.x + source.width / 2 + startDirection.x * source.width / 2);
      expect(y0).toBeCloseTo(source.y + source.height / 2 + startDirection.y * source.height / 2);
      expect(x3 + endDirection.x * 8).toBeCloseTo(target.x + target.width / 2 - endDirection.x * target.width / 2);
      expect(y3 + endDirection.y * 8).toBeCloseTo(target.y + target.height / 2 - endDirection.y * target.height / 2);
      if (endDirection.x === 0) {
        expect(x2).toBe(x3); expect(Math.sign(y3 - y2)).toBe(endDirection.y);
        expect(Math.sign(y1 - y0)).toBe(startDirection.y);
        if (!arch) {
          expect(Math.min(y0, y1, y2, y3)).toBeGreaterThanOrEqual(Math.min(source.y + source.height, target.y + target.height));
          expect(Math.max(y0, y1, y2, y3)).toBeLessThanOrEqual(Math.max(source.y, target.y));
        }
      } else {
        expect(y2).toBe(y3); expect(Math.sign(x3 - x2)).toBe(endDirection.x);
        expect(Math.sign(x1 - x0)).toBe(startDirection.x);
      }
      for (let i = 1; i <= 1000; i++) {
        const t = i / 1000, u = 1 - t;
        const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
        const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
        for (const node of [source, target, ...between]) expect(x > node.x && x < node.x + node.width
          && y > node.y && y < node.y + node.height).toBe(false);
      }
    }
  };
  try {
    act(() => root.render(<NetworkPlanView {...props} />));
    const numRows = (items: TaskState[]) => new Set(items.map(item => bounds(item.id).y)).size;
    const today = tasks.filter(item => item.effectiveDateKey < '2026-10-18');
    const twoLaneRows = numRows(today);
    expect(bounds('F').y).toBeGreaterThan(Math.max(...today.map(item => bounds(item.id).y)));
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
    expect(numRows(today)).toBe(today.length);
    verifyEdges();
    width = 1200;
    act(() => resize());
    expect(numRows(today)).toBeLessThan(twoLaneRows);
    verifyEdges();
    act(() => root.render(<NetworkPlanView {...props} now={new Date(2026, 9, 18, 0, 1)} />));
    expect(element.textContent).not.toContain('2026-10-17');
    expect(element.textContent).toContain('2026-10-18');
    expect(numRows(tasks)).toBe(Math.ceil(tasks.length / 4));
    verifyEdges();

    // Opposite seed orders produce three avoidable crossings between these rows.
    const matching = [task('A', 18), task('B', 18), task('C', 18),
      task('Z', 19, ['A']), task('Y', 19, ['B']), task('X', 19, ['C'])];
    act(() => root.render(<NetworkPlanView {...props} openTasks={matching} />));
    const byX = (a: string, b: string) => bounds(a).x - bounds(b).x;
    expect((['A', 'B', 'C'] as const).slice().sort(byX).map(id => ({ A: 'Z', B: 'Y', C: 'X' }[id])))
      .toEqual(['X', 'Y', 'Z'].sort(byX));

    // Sources in different time ranges and a common destination row once hid this crossing.
    const wrapped = ['153', 'P', 'Q', 'R', 'S', 'T', 'U', '197'].map(id =>
      ({ ...task(id, 18), sortSlot: id === '197' ? 120 : 0 }));
    wrapped.push(...[task('V', 19), task('137', 19, ['197']), task('254', 19, ['153']), task('W', 19)]
      .map(item => ({ ...item, sortSlot: 0 })));
    act(() => root.render(<NetworkPlanView {...props} openTasks={wrapped} />));
    expect(bounds('153').y).toBeLessThan(bounds('197').y);
    expect(bounds('137').y).toBe(bounds('254').y);
    const curve = (edge: string) => element.querySelector(`[data-edge-key="${edge}"] path[marker-end]`)!
      .getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const long = curve('153->254'), short = curve('197->137');
    // Compare the rendered Béziers at equal heights throughout the shared span.
    const xAtY = (p: number[], y: number) => {
      const coord = (i: number, t: number) => (1 - t) ** 3 * p[i] + 3 * (1 - t) ** 2 * t * p[i + 2]
        + 3 * (1 - t) * t ** 2 * p[i + 4] + t ** 3 * p[i + 6];
      let lo = 0, hi = 1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (coord(1, mid) < y) lo = mid;
        else hi = mid;
      }
      return coord(0, (lo + hi) / 2);
    };
    const order = Math.sign(long[6] - short[6]);
    for (let i = 0; i <= 100; i++) {
      const y = short[1] + (short[7] - short[1]) * i / 100;
      expect(Math.sign(xAtY(long, y) - xAtY(short, y))).toBe(order);
    }

    // A time marker changes the band even on the same calendar date. Reordering in the
    // list alone must neither move a card to a different lane nor change its fitted x.
    const slotted = [...matching, task('later', 18)].map((item, index) =>
      ({ ...item, sortSlot: item.id === 'later' ? 840 : 0, manualOrder: index }));
    act(() => root.render(<NetworkPlanView {...props} openTasks={slotted} />));
    expect(bounds('later').y).toBeGreaterThan(Math.max(...['A', 'B', 'C'].map(id => bounds(id).y)));
    expect(bounds('later').y).toBeLessThan(bounds('X').y);
    const orderedBounds = slotted.map(item => bounds(item.id));
    const reordered = slotted.slice().reverse().map((item, index) => ({ ...item, manualOrder: index }));
    act(() => root.render(<NetworkPlanView {...props} openTasks={reordered} />));
    expect(slotted.map(item => bounds(item.id))).toEqual(orderedBounds);

    // Fill all four lanes with alternating project assignments. The incoming list
    // interleaves both projects, while the plan groups them from left to right.
    const projectTasks = Array.from({ length: 8 }, (_, index) => task(String(index), 18));
    const projectMembers = new Map(projectTasks.map((item, index) =>
      [item.id, new Set([index % 2 ? 'east' : 'west'])] as const));
    act(() => root.render(<NetworkPlanView {...props} openTasks={projectTasks}
      projectOrder={['west', 'east']} projectMembers={projectMembers} />));
    const projectGroup = (project: string) => projectTasks.filter(item => projectMembers.get(item.id)?.has(project));
    const furthestRight = (project: string) => Math.max(...projectGroup(project).map(item => bounds(item.id).x));
    const furthestLeft = (project: string) => Math.min(...projectGroup(project).map(item => bounds(item.id).x));
    expect(furthestRight('west')).toBeLessThan(furthestLeft('east'));
    expect(numRows(projectTasks)).toBe(2);
    act(() => root.render(<NetworkPlanView {...props} openTasks={projectTasks}
      projectOrder={['east', 'west']} projectMembers={projectMembers} />));
    expect(furthestRight('east')).toBeLessThan(furthestLeft('west'));
    const visualOrder = projectTasks.map(item => item.id).sort((a, b) =>
      bounds(a).y - bounds(b).y || bounds(a).x - bounds(b).x);
    const pick = element.querySelector<HTMLElement>(`[data-task-drag="${visualOrder[3]}"]`)!;
    act(() => pick.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(noop).toHaveBeenLastCalledWith(visualOrder[3], expect.objectContaining({ shiftKey: true }), visualOrder);

    // In a partially filled range the free positions belong to the middle row.
    const ten = [...projectTasks, task('extra-a', 18), task('extra-b', 18)];
    act(() => root.render(<NetworkPlanView {...props} openTasks={ten} />));
    const packedRows = new Map<number, number>();
    for (const item of ten) {
      const y = bounds(item.id).y;
      packedRows.set(y, (packedRows.get(y) ?? 0) + 1);
    }
    expect([...packedRows.entries()].sort(([a], [b]) => a - b).map(([, count]) => count)).toEqual([4, 2, 4]);

    // The only edge skips a card in a full row. Ignoring the intervening card
    // would draw a false attachment straight through both of its side ports.
    const skipped = [task('a', 18), task('b', 18), task('c', 18, ['a']), task('d', 18)];
    act(() => root.render(<NetworkPlanView {...props} openTasks={skipped} />));
    expect(numRows(skipped)).toBe(1);
    expect(bounds('b').x).toBeGreaterThan(bounds('a').x);
    expect(bounds('b').x).toBeLessThan(bounds('c').x);
    const archCurve = curve('a->c');
    const obstacle = bounds('b');
    const ports = [[obstacle.x, obstacle.y + obstacle.height / 2],
      [obstacle.x + obstacle.width / 2, obstacle.y], [obstacle.x + obstacle.width, obstacle.y + obstacle.height / 2]];
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, u = 1 - t;
      const at = (k: number) => u ** 3 * archCurve[k] + 3 * u * u * t * archCurve[k + 2]
        + 3 * u * t * t * archCurve[k + 4] + t ** 3 * archCurve[k + 6];
      const x = at(0), y = at(1);
      expect(x > obstacle.x && x < obstacle.x + obstacle.width && y > obstacle.y
        && y < obstacle.y + obstacle.height).toBe(false);
      expect(Math.min(...ports.map(([px, py]) => Math.hypot(px - x, py - y)))).toBeGreaterThan(8);
    }
    verifyEdges();

    // A single lane forces the connected cards to choose different rows. Each role
    // has one empty outer row available, with the unrelated card between them.
    width = 400;
    act(() => resize());
    const roles = [task('before', 18), task('sink', 19, ['before']), task('isolated', 19),
      task('source', 19), task('after', 20, ['source'])];
    act(() => root.render(<NetworkPlanView {...props} openTasks={roles} />));
    expect(bounds('sink').y).toBeLessThan(bounds('isolated').y);
    expect(bounds('isolated').y).toBeLessThan(bounds('source').y);
    width = 1200;
    act(() => resize());

    const activeTasks = tasks.map(task => ({ ...task, isActive: ['C', 'B', 'F'].includes(task.id) }));
    const activeProps = { ...props, openTasks: activeTasks };
    act(() => root.render(<NetworkPlanView {...activeProps} />));
    // The active range occupies the top row at this width, including tomorrow's active task.
    expect(numRows(activeTasks.filter(item => item.isActive))).toBe(1);
    expect(bounds('F').y).toBeLessThan(Math.min(...activeTasks.filter(item => !item.isActive).map(item => bounds(item.id).y)));
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
    const active = activeTasks.filter(item => item.isActive);
    expect(numRows(active)).toBe(active.length);
    expect(Math.max(...active.map(item => bounds(item.id).y))).toBeLessThan(bounds('X').y);
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
