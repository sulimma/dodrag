import { curvesCross, sampleCurve, type Cubic } from './networkCrossings';

type Edge = { from: string; to: string };
type Box = { x: number; y: number; cx: number; cy: number; width: number; height: number };
type Row = readonly { id: string }[];
type Stroke = ReturnType<typeof sampleCurve>;
type Contact = { id: string; depth: number; push: number; fraction: number; body?: boolean };

const PORT_CLEARANCE = 20;
const EPS = 0.001;

function portContact(curve: Stroke, x: number, y: number) {
  if (x < curve.left - PORT_CLEARANCE || x > curve.right + PORT_CLEARANCE ||
      y < curve.top - PORT_CLEARANCE || y > curve.bottom + PORT_CLEARANCE) return;
  let distance2 = PORT_CLEARANCE ** 2, offsetX = 0, fraction = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const a = curve.points[i - 1], b = curve.points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const distanceX = x - (a.x + t * dx), distanceY = y - (a.y + t * dy);
    const d2 = distanceX ** 2 + distanceY ** 2;
    if (d2 < distance2) {
      distance2 = d2;
      offsetX = distanceX;
      fraction = (i - 1 + t) / (curve.points.length - 1);
    }
  }
  if (distance2 < PORT_CLEARANCE ** 2) {
    const depth = PORT_CLEARANCE - Math.sqrt(distance2);
    return { depth, push: offsetX < -EPS ? -depth : depth, fraction };
  }
}

// Optimize each feasible slide independently. Crossings and foreign port clearance
// take precedence over horizontal wirelength. The project seed breaks equal-cost ties.
export function refineNetworkPositions(
  rows: readonly Row[], boxes: Record<string, Box>, edges: readonly Edge[],
  route: (edge: Edge) => Cubic, left: number, right: number, gap: number,
) {
  if (!edges.length) return;
  const locations = new Map<string, { row: number; col: number; min: number; max: number; seed: number }>();
  for (const [r, row] of rows.entries()) {
    const free = right - left - row.reduce((n, { id }) => n + boxes[id].width, 0) - (row.length - 1) * gap;
    let min = left;
    for (const [col, { id }] of row.entries()) {
      locations.set(id, { row: r, col, min, max: min + Math.max(0, free), seed: boxes[id].x });
      min += boxes[id].width + gap;
    }
  }
  if (![...locations.values()].some(pos => pos.max - pos.min > EPS)) return;

  const incident = new Map<string, string[]>();
  const byRow: number[][] = rows.map(() => []);
  // Vertical extents stay fixed during horizontal refinement, including same-row arches.
  const spans = edges.map((edge, i) => {
    for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const neighbors = incident.get(a) ?? [];
      neighbors.push(b);
      incident.set(a, neighbors);
    }
    const a = locations.get(edge.from)!.row, b = locations.get(edge.to)!.row;
    const first = Math.max(0, Math.min(a, b) - 1), last = Math.min(rows.length - 1, Math.max(a, b) + 1);
    for (let r = first; r <= last; r++) byRow[r].push(i);
    return { first, last };
  });
  // Horizontal translation that clears the sampled stroke from the open rectangle.
  // Clip each stroke segment to the card's Y interval; a tall edge can traverse
  // a whole card between two consecutive sample vertices.
  function bodyContact(curve: Stroke, box: Box) {
    if (box.y + box.height <= curve.top || box.y >= curve.bottom ||
        box.x + box.width <= curve.left || box.x >= curve.right) return;
    let minX = Infinity, maxX = -Infinity, fraction = 0.5;
    for (let j = 1; j < curve.points.length; j++) {
      const p = curve.points[j - 1], q = curve.points[j];
      if (Math.max(p.y, q.y) <= box.y || Math.min(p.y, q.y) >= box.y + box.height) continue;
      const dy = q.y - p.y, dx = q.x - p.x;
      const t1 = dy ? Math.max(0, Math.min(1, (box.y - p.y) / dy)) : 0;
      const t2 = dy ? Math.max(0, Math.min(1, (box.y + box.height - p.y) / dy)) : 1;
      const x1 = p.x + t1 * dx, x2 = p.x + t2 * dx;
      minX = Math.min(minX, x1, x2);
      maxX = Math.max(maxX, x1, x2);
      fraction = (j - 1 + (t1 + t2) / 2) / (curve.points.length - 1);
    }
    const east = maxX - box.x, west = minX - box.x - box.width;
    if (east <= EPS || west >= -EPS) return;
    const push = east <= -west ? east + 2 : west - 2;
    return { depth: Math.abs(push), push, fraction, body: true };
  }

  type Geometry = { cubic: Cubic; curve: Stroke; contacts: Contact[]; bodies: number; pressure: number; run: number };
  function measure(i: number, previous?: Geometry, moved?: Map<string, number>): Geometry {
    const edge = edges[i], cubic = route(edge);
    const unchanged = previous && cubic.every((p, k) => p.x === previous.cubic[k].x && p.y === previous.cubic[k].y);
    const curve = unchanged ? previous.curve : sampleCurve(cubic);
    const contacts = unchanged ? previous.contacts.filter(c => !moved!.has(c.id)) : [];
    function inspect(id: string) {
      const b = boxes[id];
      if (id === edge.from || id === edge.to || b.x - PORT_CLEARANCE > curve.right ||
          b.x + b.width + PORT_CLEARANCE < curve.left || b.y + b.height + PORT_CLEARANCE < curve.top ||
          b.y - PORT_CLEARANCE > curve.bottom) return;
      const body = bodyContact(curve, b);
      if (body) contacts.push({ id, ...body });
      for (const [x, y] of [[b.cx, b.y], [b.cx, b.y + b.height], [b.x, b.cy], [b.x + b.width, b.cy]]) {
        const contact = portContact(curve, x, y);
        if (contact) contacts.push({ id, ...contact });
      }
    }
    if (unchanged) {
      for (const id of moved!.keys()) inspect(id);
    } else {
      for (let r = spans[i].first; r <= spans[i].last; r++) {
        for (const { id } of rows[r]) inspect(id);
      }
    }
    let bodies = 0, pressure = 0;
    for (const c of contacts) {
      if (c.body) bodies++;
      pressure += c.depth ** 2;
    }
    return { curve, cubic, contacts, bodies, pressure, run: Math.abs(boxes[edge.from].cx - boxes[edge.to].cx) };
  }
  const state = edges.map((_, i) => measure(i));
  // Sweep vertical spans without expanding long edges into a list of all their peers.
  const edgeOrder = edges.map((_, i) => i).sort((a, b) => spans[a].first - spans[b].first);
  // Cap trial work by the number of local stroke updates on highly connected graphs.
  let remaining = 8000;

  function independent(i: number, j: number) {
    const a = edges[i], b = edges[j];
    return a.from !== b.from && a.from !== b.to && a.to !== b.from && a.to !== b.to;
  }
  function setLeft(id: string, x: number) {
    boxes[id].x = x;
    boxes[id].cx = x + boxes[id].width / 2;
  }
  // Moving one card may push a compact run of neighbors. Clamp at the available
  // slack of the entire row, so a hole beyond the immediate neighbor is reachable.
  function trySlide(group: string[], desired: number) {
    if (remaining <= 0) return false;
    let delta = desired;
    for (const id of group) {
      const loc = locations.get(id)!;
      delta = Math.max(loc.min - boxes[id].x, Math.min(loc.max - boxes[id].x, delta));
    }
    if (Math.abs(delta) < EPS) return false;
    const old = new Map<string, number>();
    function move(id: string, x: number) {
      old.set(id, boxes[id].x);
      setLeft(id, x);
    }
    for (const id of group) {
      const { row: r, col } = locations.get(id)!, row = rows[r];
      move(id, boxes[id].x + delta);
      if (delta > 0) {
        for (let c = col + 1; c < row.length; c++) {
          const prev = boxes[row[c - 1].id], next = row[c].id, x = prev.x + prev.width + gap;
          if (boxes[next].x >= x - EPS) break;
          move(next, x);
        }
      } else {
        for (let c = col - 1; c >= 0; c--) {
          const prev = row[c].id, x = boxes[row[c + 1].id].x - gap - boxes[prev].width;
          if (boxes[prev].x <= x + EPS) break;
          move(prev, x);
        }
      }
    }
    const affected = new Set<number>();
    let tether = 0;
    for (const [id, x] of old) {
      const loc = locations.get(id)!, box = boxes[id];
      tether += Math.abs(box.x - loc.seed) - Math.abs(x - loc.seed);
      for (const i of byRow[loc.row]) {
        const edge = edges[i];
        // All candidate bows stay within 36px of the endpoint X interval.
        const low = Math.min(boxes[edge.from].cx, boxes[edge.to].cx) - 36 - PORT_CLEARANCE;
        const high = Math.max(boxes[edge.from].cx, boxes[edge.to].cx) + 36 + PORT_CLEARANCE;
        if (edge.from === id || edge.to === id ||
          (Math.min(x, box.x) <= high && Math.max(x, box.x) + box.width >= low)) affected.add(i);
      }
    }
    const trial = new Map<number, Geometry>();
    let crossingDelta = 0, bodyDelta = 0, pressureDelta = 0, runDelta = 0;
    remaining -= 1 + affected.size;
    const changed = new Set<number>();
    for (const i of affected) {
      const prev = state[i], next = measure(i, prev, old);
      trial.set(i, next);
      bodyDelta += next.bodies - prev.bodies;
      pressureDelta += next.pressure - prev.pressure;
      runDelta += next.run - prev.run;
      if (next.curve !== prev.curve) changed.add(i);
    }
    for (const i of changed) {
      for (const j of edgeOrder) {
        if (spans[j].first > spans[i].last) break;
        if (spans[j].last < spans[i].first || !independent(i, j)) continue;
        if (j < i && changed.has(j)) continue;
        const after = curvesCross(trial.get(i)!.curve, (trial.get(j) ?? state[j]).curve);
        const before = curvesCross(state[i].curve, state[j].curve);
        crossingDelta += Number(after) - Number(before);
      }
    }
    const improvement = [crossingDelta, bodyDelta, pressureDelta, runDelta, tether].find(d => Math.abs(d) > EPS);
    if (improvement !== undefined && improvement < 0) {
      for (const [i, geometry] of trial) state[i] = geometry;
      return true;
    }
    for (const [id, x] of old) setLeft(id, x);
    return false;
  }

  // An already aligned vertical chain may need to move together to reach its
  // next neighbor. Its members occupy distinct rows in common chains.
  function align(group: string[]) {
    const first = boxes[group[0]];
    const targets: number[] = [];
    for (const id of group) for (const neighbor of incident.get(id) ?? []) {
      if (!group.includes(neighbor) && boxes[id].y !== boxes[neighbor].y) targets.push(boxes[neighbor].cx);
    }
    if (!targets.length) return false;
    targets.sort((a, b) => a - b);
    // The median interval minimizes total absolute horizontal run.
    const low = targets[(targets.length - 1) >>> 1], high = targets[targets.length >>> 1];
    const dx = Math.max(low, Math.min(high, first.cx)) - first.cx;
    return trySlide(group, dx) || trySlide(group, dx / 2);
  }
  const ids = [...locations.keys()];
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const id of (pass % 2 ? [...ids].reverse() : ids)) {
      if (align([id])) moved = true;
    }
    const seen = new Set<string>();
    for (const start of ids) {
      if (seen.has(start)) continue;
      const group = [start], x = boxes[start].cx;
      seen.add(start);
      for (let n = 0; n < group.length; n++) {
        for (const next of incident.get(group[n]) ?? []) {
          if (seen.has(next) || Math.abs(boxes[next].cx - x) > EPS) continue;
          group.push(next);
          seen.add(next);
        }
      }
      if (group.length > 1 && align(group)) moved = true;
    }

    // Try each repulsion independently: a blocked port elsewhere cannot veto it.
    const pushes = new Map<string, number>();
    function propose(id: string, dx: number) {
      if (Math.abs(dx) > Math.abs(pushes.get(id) ?? 0)) pushes.set(id, dx);
    }
    for (const [i, geometry] of state.entries()) for (const contact of geometry.contacts) {
      propose(contact.id, contact.push);
      propose(edges[i].from, -contact.push * (1 - contact.fraction));
      propose(edges[i].to, -contact.push * contact.fraction);
    }
    for (const [id, dx] of pushes) {
      if (trySlide([id], dx * 1.2) || trySlide([id], -dx * 1.2)) moved = true;
    }
    if (!moved || remaining <= 0) break;
  }
}
