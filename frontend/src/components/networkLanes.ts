import type { TaskState } from '../domain/types';

type Edge = { from: string; to: string };
type Placement = { task: TaskState; lane: number; band: number };
type Link = { source: Placement; target: Placement };

function creationOrder(a: TaskState, b: TaskState) {
  return a.creationOrder - b.creationOrder || a.id.localeCompare(b.id);
}

// Seed contiguous project groups in sidebar order. Sparse bands prefer the same
// relative project position across dates. Dense bands use balanced lane loads.
function seedBand(tasks: TaskState[], band: number, width: number,
  projectOf: (task: TaskState) => number, preferredLane: Map<number, number>) {
  const sorted = [...tasks].sort((a, b) =>
    projectOf(a) - projectOf(b) || creationOrder(a, b));
  const minimum = Math.floor(sorted.length / width);
  let extras = sorted.length % width;
  let cursor = 0;
  return Array.from({ length: width }, (_, lane) => {
    let count = minimum;
    if (extras > 0 && (extras === width - lane ||
        preferredLane.get(projectOf(sorted[cursor + minimum]))! <= lane + 0.5)) {
      count++;
      extras--;
    }
    const cards = sorted.slice(cursor, cursor + count).map(task => ({ task, lane, band }));
    cursor += count;
    return cards;
  });
}

// Score independent line segments on the collapsed bands. Coincident endpoints
// of distinct cards represent an unresolved order, worth half a crossing.
function crossing(a: Link, b: Link) {
  const { source: p, target: q } = a;
  const { source: r, target: s } = b;
  if (p === r || p === s || q === r || q === s) return 0;
  if (Math.max(p.band, q.band) < Math.min(r.band, s.band)
    || Math.max(r.band, s.band) < Math.min(p.band, q.band)
    || Math.max(p.lane, q.lane) < Math.min(r.lane, s.lane)
    || Math.max(r.lane, s.lane) < Math.min(p.lane, q.lane)) return 0;
  const side = (u: Placement, v: Placement, t: Placement) =>
    Math.sign((v.lane - u.lane) * (t.band - u.band) - (v.band - u.band) * (t.lane - u.lane));
  const first = side(p, q, r) * side(p, q, s);
  const second = side(r, s, p) * side(r, s, q);
  if (first > 0 || second > 0) return 0;
  return first < 0 && second < 0 ? 1 : 0.5;
}

function improveLanes(bands: Placement[][][], links: Link[]) {
  if (!links.length) return;
  const incident = new Map<Placement, Link[]>();
  for (const link of links) {
    for (const card of [link.source, link.target]) {
      const list = incident.get(card) ?? [];
      list.push(link);
      incident.set(card, list);
    }
  }
  const lowerBand = ({source, target}: Link) => Math.min(source.band, target.band);
  const ordered = [...links].sort((a, b) => lowerBand(a) - lowerBand(b));
  // Many consecutive bands have disjoint vertical spans. Index possible partners
  // on demand and share the index across every trial involving that link.
  const peers = new Map<Link, Link[]>();
  function neighbors(a: Link) {
    let found = peers.get(a);
    if (found) return found;
    found = [];
    const low = lowerBand(a), high = Math.max(a.source.band, a.target.band);
    for (const b of ordered) {
      if (lowerBand(b) > high) break;
      if (Math.max(b.source.band, b.target.band) < low || a.source === b.source ||
        a.source === b.target || a.target === b.source || a.target === b.target) continue;
      found.push(b);
    }
    peers.set(a, found);
    return found;
  }
  // Bound synchronous work on dense bands during resize. An unfinished trial
  // keeps the last accepted placement. A fixed work limit keeps re-layout stable.
  let remaining = 500_000;
  function tryMove(card: Placement, lane: number, other?: Placement) {
    const original = card.lane;
    const affected = new Set([...(incident.get(card) ?? []), ...(other ? incident.get(other) ?? [] : [])]);
    const score = () => {
      let crossings = 0, span = 0;
      const visited = new Set<Link>();
      for (const a of affected) {
        // The vertical distance is fixed. Penalize lateral displacement even on
        // a long link, where Euclidean length barely changes with a lane move.
        if (a.source.band !== a.target.band) span += (a.source.lane - a.target.lane) ** 2;
        for (const b of neighbors(a)) {
          if (visited.has(b)) continue;
          if (--remaining < 0) return;
          crossings += crossing(a, b);
        }
        visited.add(a);
      }
      return { crossings, span };
    };
    const before = score();
    if (!before || (before.crossings === 0 && before.span === 0)) return false;
    card.lane = lane;
    if (other) other.lane = original;
    const after = score();
    if (after && (after.crossings < before.crossings ||
        (after.crossings === before.crossings && after.span < before.span))) return true;
    card.lane = original;
    if (other) other.lane = lane;
    return false;
  }
  for (let pass = 0; pass < 8; pass++) {
    // Consider endpoints of diagonal links as well as endpoints of crossing pairs.
    const candidates = new Set<Placement>();
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      if (a.source.band !== a.target.band && a.source.lane !== a.target.lane) {
        candidates.add(a.source).add(a.target);
      }
      const last = Math.max(a.source.band, a.target.band);
      for (let j = i + 1; j < ordered.length && lowerBand(ordered[j]) <= last; j++) {
        const b = ordered[j];
        if (--remaining < 0) return;
        if (crossing(a, b)) {
          candidates.add(a.source).add(a.target).add(b.source).add(b.target);
        }
      }
    }
    if (!candidates.size) break;
    let changed = false;
    for (let i = 0; i < bands.length; i++) {
      const lanes = bands[pass % 2 === 0 ? bands.length - i - 1 : i];
      const cards = lanes.flat();
      const capacity = Math.ceil(cards.length / lanes.length);
      for (const card of cards) {
        if (remaining <= 0) return;
        if (!candidates.has(card)) continue;
        const origin = lanes[card.lane];
        // Try local swaps first. Direct alignment can clear a run of lanes
        // when the first neighboring swap alone would introduce a crossing.
        const targets = new Set([card.lane - 1, card.lane + 1]);
        for (const link of incident.get(card) ?? []) {
          const partner = link.source === card ? link.target : link.source;
          if (partner.band !== card.band && partner.lane !== card.lane) targets.add(partner.lane);
        }
        for (const j of targets) {
          const neighbor = lanes[j];
          if (!neighbor) continue;
          if (neighbor.length < capacity && tryMove(card, j)) {
            origin.splice(origin.indexOf(card), 1);
            neighbor.push(card);
            changed = true;
            break;
          }
          // Every isolated occupant produces the same geometry in a swap.
          let triedIsolated = false;
          const m = neighbor.findIndex(other => {
            if (remaining <= 0) return false;
            if (!incident.has(other)) {
              if (triedIsolated) return false;
              triedIsolated = true;
            }
            return tryMove(card, j, other);
          });
          if (m >= 0) {
            origin[origin.indexOf(card)] = neighbor[m];
            neighbor[m] = card;
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
}

export function layoutNetworkLanes(
  bands: TaskState[][], laneCount: number, edges: Edge[], projectOf: (task: TaskState) => number,
): Placement[][][] {
  const width = Math.max(1, Math.floor(laneCount));
  const projects = [...new Set(bands.flat().map(projectOf))].sort((a, b) => a - b);
  const preferredLane = new Map(projects.map((id, index) =>
    [id, projects.length < 2 ? (width - 1) / 2 : index * (width - 1) / (projects.length - 1)]));
  const lanesByBand = bands.map((tasks, i) => seedBand(tasks, i, width, projectOf, preferredLane));
  const byId = new Map(lanesByBand.flat(2).map(card => [card.task.id, card]));
  const links: Link[] = [];
  const incoming = new Set<Placement>(), outgoing = new Set<Placement>();
  for (const edge of edges) {
    const source = byId.get(edge.from), target = byId.get(edge.to);
    if (source && target) {
      links.push({ source, target });
      outgoing.add(source);
      incoming.add(target);
    }
  }
  if (width > 1) improveLanes(lanesByBand, links);
  const verticalOrder = (card: Placement) => Number(outgoing.has(card)) - Number(incoming.has(card));
  return lanesByBand.map(lanes => {
    const height = lanes.reduce((max, lane) => Math.max(max, lane.length), 0);
    const rows: Placement[][] = Array.from({ length: height }, () => []);
    for (const lane of lanes) {
      lane.sort((a, b) => verticalOrder(a) - verticalOrder(b) || creationOrder(a.task, b.task));
      const sinks = lane.filter(card => verticalOrder(card) < 0).length;
      const sources = lane.filter(card => verticalOrder(card) > 0).length;
      let top = sinks, bottom = height - sources - 1;
      const neutralRows: number[] = [];
      for (let i = sinks; i < lane.length - sources; i++) {
        // Use the outermost free slot. Balance equally distant choices across
        // lanes, then assign neutral cards in their stable creation order.
        const bottomDepth = height - 1 - bottom;
        if (top < bottomDepth || (top === bottomDepth && rows[top].length <= rows[bottom].length)) {
          neutralRows.push(top++);
        } else {
          neutralRows.push(bottom--);
        }
      }
      neutralRows.sort((a, b) => a - b);
      lane.forEach((card, i) => {
        let row = i;
        if (i >= lane.length - sources) row = height - lane.length + i;
        else if (i >= sinks) row = neutralRows[i - sinks];
        rows[row].push(card);
      });
    }
    return rows;
  });
}
