import { expect, it } from 'vitest';
import type { Cubic } from './networkCrossings';
import { refineNetworkPositions } from './networkRefinement';

it('keeps an unrelated card attachment clear of a passing connection when the row has space', () => {
  const slot = (y: number) => ({ x: 200, cx: 300, y, cy: y + 28, width: 200, height: 56 });
  const nodes = { source: slot(0), unrelated: slot(140), target: slot(280) };
  const rows = [[{ id: 'source' }], [{ id: 'unrelated' }], [{ id: 'target' }]];
  const edge = { from: 'source', to: 'target' };
  const route = (): Cubic => {
    const start = { x: nodes.source.cx, y: nodes.source.y + nodes.source.height };
    const end = { x: nodes.target.cx, y: nodes.target.y };
    return [start, start, end, end];
  };
  refineNetworkPositions(rows, nodes, [edge], route, 0, 600, 16);

  const [a, , , b] = route();
  for (const y of [nodes.unrelated.y, nodes.unrelated.y + nodes.unrelated.height]) {
    const xOnLine = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
    expect(Math.abs(nodes.unrelated.cx - xOnLine)).toBeGreaterThan(8);
  }
  for (const node of Object.values(nodes)) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.x + node.width).toBeLessThanOrEqual(600);
  }
});

it('aligns a chain and adjacent dependency using the free positions of shorter rows', () => {
  const rowIds = [
    ['left-a', 'left-b', '256', '153', 'right'],
    ['mid-a', 'mid-b', 'mid-c', '120', '254', 'mid-f'],
    ['lower-a', 'lower-b', '123'],
  ];
  const lanes = [[0, 1, 2, 3, 5], [0, 1, 2, 3, 4, 5], [0, 1, 2]];
  const rows = rowIds.map(row => row.map(id => ({ id })));
  const width = 232, gap = 16;
  const boxes = Object.fromEntries(rows.flatMap((row, r) => row.map(({ id }, c) => {
    const x = lanes[r][c] * (width + gap), y = 144 * r;
    return [id, { x, y, cx: x + width / 2, cy: y + 28, width, height: 56 }] as const;
  })));
  const edges = [{ from: '256', to: '120' }, { from: '153', to: '254' }, { from: '120', to: '123' }];
  const route = ({ from, to }: { from: string; to: string }): Cubic => {
    const start = { x: boxes[from].cx, y: boxes[from].y + 56 };
    const end = { x: boxes[to].cx, y: boxes[to].y };
    const middle = (start.y + end.y) / 2;
    return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
  };
  refineNetworkPositions(rows, boxes, edges, route, 0, 6 * width + 5 * gap, gap);
  for (const { from, to } of edges) {
    expect(Math.abs(boxes[from].cx - boxes[to].cx), `${from} → ${to}`).toBeLessThan(1);
  }
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      const left = boxes[row[i - 1].id], right = boxes[row[i].id];
      expect(right.x - left.x).toBeGreaterThanOrEqual(width + gap);
    }
  }
});

it('moves a loose card clear of a straight connection through its body away from its ports', () => {
  const box = (x: number, y: number) => ({ x, y, cx: x + 100, cy: y + 28, width: 200, height: 56 });
  const boxes = {
    source: box(0, 0), topRight: box(216, 0),
    obstacle: box(50, 160),
    target: box(0, 320), bottomRight: box(216, 320),
  };
  const rows = [['source', 'topRight'], ['obstacle'], ['target', 'bottomRight']].map(row => row.map(id => ({ id })));
  const route = (): Cubic => {
    const start = { x: boxes.source.cx, y: boxes.source.y + boxes.source.height };
    const end = { x: boxes.target.cx, y: boxes.target.y };
    return [start, start, end, end];
  };
  refineNetworkPositions(rows, boxes, [{ from: 'source', to: 'target' }], route, 0, 416, 16);
  expect(boxes.target.cx).toBe(boxes.source.cx);
  expect(boxes.obstacle.x).toBeGreaterThan(boxes.source.cx);
  expect(boxes.obstacle.x + boxes.obstacle.width).toBeLessThanOrEqual(416);
});
