import type { Point } from './arrowGeometry';

export type Cubic = [Point, Point, Point, Point];

export function pointOnCurve([a, b, c, d]: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  };
}

export function pathData([a, b, c, d]: Cubic) {
  return `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`;
}

export function sampleCurve(curve: Cubic) {
  const xs = curve.map(p => p.x), ys = curve.map(p => p.y);
  return {
    left: Math.min(...xs), right: Math.max(...xs),
    top: Math.min(...ys), bottom: Math.max(...ys),
    points: Array.from({ length: 25 }, (_, i) => pointOnCurve(curve, i / 24)),
  };
}

function side(a: Point, b: Point, p: Point) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

export function curvesCross(a: ReturnType<typeof sampleCurve>, b: ReturnType<typeof sampleCurve>) {
  if (a.bottom < b.top || b.bottom < a.top || a.right < b.left || b.right < a.left) return false;
  for (let i = 1; i < a.points.length; i++) {
    const p = a.points[i - 1], q = a.points[i];
    for (let j = 1; j < b.points.length; j++) {
      const r = b.points[j - 1], s = b.points[j];
      if (Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) continue;
      if ((side(p, q, r) > 0) !== (side(p, q, s) > 0)
        && (side(r, s, p) > 0) !== (side(r, s, q) > 0)) return true;
    }
  }
  return false;
}
