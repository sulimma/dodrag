import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, GripVertical } from 'lucide-react';
import {
  computeTransitiveReductionEdges,
  dateKeyToIsoStart,
  formatDateHeading,
  toDateKey,
} from '../domain/projector';
import { HighlightRole, TaskState } from '../domain/types';
import { DateLayerLine } from './DateLayerLine';
import { TaskTitle } from './TaskTitle';
import { InlineEditor } from './inlineEditor';
import { taskAppearanceRole } from './taskAppearance';
import { TaskDate } from './TaskDate';
import { taskInteractions, TaskViewInteractions } from './taskInteractions';
import { edgesWithPreview } from '../domain/dependencyPaths';
import { stableTopology } from '../domain/topology';
import { TaskDragHandle } from './TaskDragHandle';
import { arrowBase, ArrowMarkers } from './arrowGeometry';

interface NetworkPlanViewProps extends TaskViewInteractions {
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
  openTasks: TaskState[];
  now: Date;
}

interface PositionedNode {
  task: TaskState;
  x: number; // Top-left X
  y: number; // Top-left Y
  cx: number; // Center X
  cy: number; // Center Y
  width: number;
  height: number;
  dateRank: number;
}

interface DateBandLayout {
  dateKey: string;
  isoDate: string;
  label: string;
  subLabel: string;
  weekdayShort: string;
  isToday: boolean;
  isWeekend: boolean;
  bandTopY: number;
  bandHeight: number;
}

interface RoutedEdge {
  from: string;
  to: string;
  pathD: string;
}

const NODE_WIDTH = 232;
const NODE_HEIGHT = 56;
const NODE_SEP_X = 16; // Compact horizontal gap between side-by-side nodes
const SUBROW_SEP_Y = 20; // Vertical gap between wrapped rows within the same day
const RANK_SEP_Y = 36; // Reduced vertical gap between date layers
const LEFT_DATE_GUTTER = 136;
const CANVAS_PAD_X = 16;
const CANVAS_PAD_Y = 18;

/**
 * One cubic Bézier with a vertical target tangent and a small bow for aligned
 * endpoints. Obstacles may adjust its curvature, but never add waypoints.
 */
export function buildCleanEdgePath(
  startPt: { x: number; y: number },
  endPt: { x: number; y: number },
  intermediateObstacles: PositionedNode[]
): string {
  endPt = arrowBase(endPt, { x: 0, y: 1 });
  const dx = endPt.x - startPt.x;
  // A 36-unit control offset bows a vertical edge by at most 16 SVG units.
  const startControlX = startPt.x + (dx < 0 ? -1 : 1) * Math.max(0, 36 - Math.abs(dx));
  let bestPath = '';
  let bestScore = Infinity;
  for (const factor of [0.42, 0.28, 0.56]) {
    const dy = Math.max(8, Math.abs(endPt.y - startPt.y) * factor);
    let score = factor === 0.42 ? 0 : 0.25;
    // ponytail: 24 samples are a soft collision heuristic, not clearance proof.
    // Crossings are allowed; use curve/rectangle intersection if that changes.
    for (let i = 1; intermediateObstacles.length > 0 && i < 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      const x = u ** 3 * startPt.x + 3 * u * u * t * startControlX
        + (3 * u * t * t + t ** 3) * endPt.x;
      const y = u ** 3 * startPt.y + 3 * u * u * t * (startPt.y + dy)
        + 3 * u * t * t * (endPt.y - dy) + t ** 3 * endPt.y;
      if (intermediateObstacles.some((obs) =>
        x >= obs.x - 8 && x <= obs.x + obs.width + 8
        && y >= obs.y - 5 && y <= obs.y + obs.height + 5
      )) score++;
    }
    if (score < bestScore) {
      bestScore = score;
      bestPath = `M ${startPt.x} ${startPt.y} C ${startControlX} ${startPt.y + dy}, ${endPt.x} ${endPt.y - dy}, ${endPt.x} ${endPt.y}`;
    }
    if (bestScore === 0) break;
  }
  return bestPath;
}

export function NetworkPlanView(props: NetworkPlanViewProps) {
  const {
    openTasks,
    now,
    selectedTaskId,
    selectedEdgeKeys,
    onSelectEdge,
    onClearEdgeSelection,
    onClearTaskSelection,
    highlights,
    draggedTaskId,
    isShiftDrag,
    onShiftKeyChange,
    activeDropTargetKey,
    setActiveDropTargetKey,
    setDraggedTaskId,
    onSetConfiguredDate,
    onToggleActive,
    titleEditor,
    dateEditor,
    deletionPreview,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(840);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const todayKey = toDateKey(now);

    // 1. Collect all relevant date layers (Today + each open task's effectiveDateKey)
    const dateKeysSet = new Set<string>([todayKey]);
    for (const t of openTasks) {
      const dk = t.effectiveDateKey < todayKey ? todayKey : t.effectiveDateKey;
      dateKeysSet.add(dk);
    }
    const sortedDateKeys = Array.from(dateKeysSet).sort();
    const dateKeyToRank = new Map<string, number>();
    sortedDateKeys.forEach((dk, idx) => dateKeyToRank.set(dk, idx));

    // 2. Transitive reduction of dependency edges (omits A->C if A->B and B->C exist)
    const reducedEdges = computeTransitiveReductionEdges(openTasks);

    // Reduced-edge neighbors guide horizontal alignment, not task ordering.
    const predsOf: Record<string, string[]> = {};
    const succsOf: Record<string, string[]> = {};
    for (const t of openTasks) {
      predsOf[t.id] = [];
      succsOf[t.id] = [];
    }
    for (const e of reducedEdges) {
      if (predsOf[e.to]) predsOf[e.to].push(e.from);
      if (succsOf[e.from]) succsOf[e.from].push(e.to);
    }

    // 3. Group tasks by their exact date rank
    const rows: TaskState[][] = sortedDateKeys.map(() => []);
    for (const t of openTasks) {
      const dk = t.effectiveDateKey < todayKey ? todayKey : t.effectiveDateKey;
      const r = dateKeyToRank.get(dk) ?? 0;
      rows[r].push(t);
    }

    // Determine how many columns fit side-by-side within the available container width
    const stepX = NODE_WIDTH + NODE_SEP_X;
    const usableWidth = Math.max(
      NODE_WIDTH,
      containerWidth - LEFT_DATE_GUTTER - CANVAS_PAD_X
    );
    const maxCols = Math.max(
      1,
      Math.floor((usableWidth + NODE_SEP_X) / stepX)
    );
    const maxAllowedX = Math.max(0, usableWidth - NODE_WIDTH);

    // A level is 1 + the maximum level of ALL same-band predecessors (roots: 0).
    // Compute levels topologically, then preserve openTasks priority within levels.
    // Wrap each entire level before starting the next, including unrelated nodes.
    const daySlices = rows.map((row) => {
      const levelOf = new Map<string, number>();
      for (const task of stableTopology(row)) {
        let level = 0;
        for (const id of task.predecessorIds) {
          const predecessorLevel = levelOf.get(id);
          if (predecessorLevel !== undefined) level = Math.max(level, predecessorLevel + 1);
        }
        levelOf.set(task.id, level);
      }
      const levels: TaskState[][] = [];
      for (const task of row) {
        const level = levelOf.get(task.id)!;
        (levels[level] ??= []).push(task);
      }
      const slices: TaskState[][] = [];
      for (const level of levels) {
        for (let start = 0; start < level.length; start += maxCols) {
          slices.push(level.slice(start, start + maxCols));
        }
      }
      return slices;
    });
    const layoutRows = daySlices.flat();

    // 4. Clamped horizontal neighbor alignment, preserving priority within each slice.
    const xPos: Record<string, number> = {};

    // Assign initial X positions within each wrapped level.
    for (const row of layoutRows) {
      row.forEach((t, idx) => {
        xPos[t.id] = (idx % maxCols) * stepX;
      });
    }

    // Helper: place a single horizontal slice of <= maxCols nodes as close as possible to their desired target X
    // while maintaining `stepX` spacing and never exceeding `[0, maxAllowedX]`.
    const resolveSlicePositions = (
      slice: TaskState[],
      desiredX: Record<string, number>
    ) => {
      if (slice.length === 0) return;
      const xs = slice.map((t) =>
        Math.max(0, Math.min(maxAllowedX, desiredX[t.id] ?? 0))
      );

      // Left-to-right pass to enforce minimum gap
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] < xs[i - 1] + stepX) {
          xs[i] = xs[i - 1] + stepX;
        }
      }
      // Clamp right boundary and sweep right-to-left so nodes never overflow right edge
      if (xs[xs.length - 1] > maxAllowedX) {
        xs[xs.length - 1] = maxAllowedX;
      }
      for (let i = xs.length - 2; i >= 0; i--) {
        if (xs[i] > xs[i + 1] - stepX) {
          xs[i] = xs[i + 1] - stepX;
        }
      }
      // Clamp left boundary and sweep left-to-right
      if (xs[0] < 0) {
        xs[0] = 0;
      }
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] < xs[i - 1] + stepX) {
          xs[i] = xs[i - 1] + stepX;
        }
      }

      slice.forEach((t, i) => {
        xPos[t.id] = xs[i];
      });
    };

    // Six neighbor-average sweeps improve alignment; crossings remain allowed.
    for (let iter = 0; iter < 6; iter++) {
      // Top-Down: align children directly under the average X of their predecessors
      for (let r = 1; r < layoutRows.length; r++) {
        const row = layoutRows[r];
        if (row.length === 0) continue;
        const desired: Record<string, number> = {};
        for (const t of row) {
          const ps = predsOf[t.id] || [];
          if (ps.length > 0) {
            const sum = ps.reduce((acc, pId) => acc + (xPos[pId] ?? 0), 0);
            desired[t.id] = sum / ps.length;
          } else {
            desired[t.id] = xPos[t.id];
          }
        }
        resolveSlicePositions(row, desired);
      }

      // Bottom-Up: approach the average X of predecessors and successors.
      for (let r = layoutRows.length - 2; r >= 0; r--) {
        const row = layoutRows[r];
        if (row.length === 0) continue;
        const desired: Record<string, number> = {};
        for (const t of row) {
          const ss = succsOf[t.id] || [];
          const ps = predsOf[t.id] || [];
          const neighbors = [...ps, ...ss];
          if (neighbors.length > 0) {
            const sum = neighbors.reduce(
              (acc, nId) => acc + (xPos[nId] ?? 0),
              0
            );
            desired[t.id] = sum / neighbors.length;
          } else {
            desired[t.id] = xPos[t.id];
          }
        }
        resolveSlicePositions(row, desired);
      }
    }

    // 5. Build positioned nodes & date bands (supporting multiple sub-rows within a day)
    const nodes: Record<string, PositionedNode> = {};
    const dateBands: DateBandLayout[] = [];
    let currentY = CANVAS_PAD_Y;

    for (let r = 0; r < sortedDateKeys.length; r++) {
      const dk = sortedDateKeys[r];
      const { label, subLabel, isToday, isWeekend, weekdayShort } =
        formatDateHeading(dk, now);

      const slices = daySlices[r];
      const isRowEmpty = slices.length === 0;
      const numSubRows = slices.length;

      const bandTopY = currentY;
      const bandHeight = isRowEmpty
        ? 38
        : 24 +
          numSubRows * NODE_HEIGHT +
          Math.max(0, numSubRows - 1) * SUBROW_SEP_Y +
          RANK_SEP_Y;
      const nodeTopY = bandTopY + 24;
      currentY += bandHeight;

      dateBands.push({
        dateKey: dk,
        isoDate: dateKeyToIsoStart(dk),
        label,
        subLabel,
        weekdayShort,
        isToday,
        isWeekend,
        bandTopY,
        bandHeight,
      });

      slices.forEach((slice, subRow) => slice.forEach((t) => {
        const x = LEFT_DATE_GUTTER + (xPos[t.id] ?? 0);
        const y = nodeTopY + subRow * (NODE_HEIGHT + SUBROW_SEP_Y);
        nodes[t.id] = {
          task: t,
          x,
          y,
          cx: x + NODE_WIDTH / 2,
          cy: y + NODE_HEIGHT / 2,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          dateRank: r,
        };
      }));
    }

    // 6. Downward endpoints keep curves outside their own cards. Intermediate
    // obstacles only influence the existing soft curvature heuristic.
    const allNodes = Object.values(nodes);
    const routedEdges: RoutedEdge[] = [];

    for (const edge of edgesWithPreview(reducedEdges,openTasks,deletionPreview)) {
      const fromNode = nodes[edge.from];
      const toNode = nodes[edge.to];
      if (!fromNode || !toNode) continue;

      const startPt = {
        x: fromNode.cx,
        y: fromNode.y + fromNode.height,
      };
      const endPt = {
        x: toNode.cx,
        y: toNode.y,
      };

      // Any node vertically between fromNode and toNode (including other sub-rows in the same day) is a potential obstacle
      const minCy = Math.min(fromNode.cy, toNode.cy);
      const maxCy = Math.max(fromNode.cy, toNode.cy);
      const intermediateObstacles = allNodes.filter(
        (n) =>
          n.task.id !== edge.from &&
          n.task.id !== edge.to &&
          n.cy > minCy + 4 &&
          n.cy < maxCy - 4
      );

      routedEdges.push({
        from: edge.from,
        to: edge.to,
        pathD: buildCleanEdgePath(startPt, endPt, intermediateObstacles),
      });
    }

    // Sort routedEdges top-to-bottom, left-to-right for deterministic Shift+Click range selection
    routedEdges.sort((a, b) => {
      const na = nodes[a.from];
      const nb = nodes[b.from];
      if (na && nb && na.y !== nb.y) return na.y - nb.y;
      if (na && nb && na.x !== nb.x) return na.x - nb.x;
      return `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`);
    });

    const orderedEdgeKeys = routedEdges.map((e) => `${e.from}->${e.to}`);

    const rightmostEdge = allNodes.reduce(
      (acc, n) => Math.max(acc, n.x + n.width),
      LEFT_DATE_GUTTER + NODE_WIDTH
    );
    const canvasWidth = Math.max(
      containerWidth,
      rightmostEdge + CANVAS_PAD_X
    );
    const canvasHeight = Math.max(420, currentY + 24);

    return {
      nodes,
      dateBands,
      routedEdges,
      orderedEdgeKeys,
      canvasWidth,
      canvasHeight,
    };
  }, [openTasks, now, containerWidth, deletionPreview.join('|')]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{
        height: layout.canvasHeight,
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-task-drag], [data-edge-key], button, input, textarea, [contenteditable="true"]')) return;
        onClearTaskSelection();
        if (selectedEdgeKeys.length > 0) onClearEdgeSelection();
      }}
    >
      {/* Thin horizontal Date Lines & Drop Zones sorting nodes into layers */}
      {layout.dateBands.map((band) => {
        const dropKey = `net-date:${band.dateKey}`;
        const isDropActive = activeDropTargetKey === dropKey;
        return (
          <DateLayerLine
            key={band.dateKey}
            dateKey={band.dateKey}
            weekdayShort={band.weekdayShort}
            isWeekend={band.isWeekend}
            isToday={band.isToday}
            isDropActive={isDropActive}
            className="absolute left-0 right-0"
            style={{
              top: band.bandTopY,
              height: band.bandHeight,
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (activeDropTargetKey !== dropKey) {
                setActiveDropTargetKey(dropKey);
              }
            }}
            onDragLeave={() => {
              if (activeDropTargetKey === dropKey) {
                setActiveDropTargetKey(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const tId =
                draggedTaskId || e.dataTransfer.getData('text/plain');
              setActiveDropTargetKey(null);
              setDraggedTaskId(null);
              if (tId) {
                onSetConfiguredDate(tId, band.isoDate, band.dateKey);
              }
            }}
          />
        );
      })}

      {/* SVG Layer for Clean, Direct Directed Edges (Multi-Selectable with Ctrl/Shift & Deletable via Del/Backspace) */}
      <svg
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        className="absolute inset-0 pointer-events-none z-10"
      >
        <ArrowMarkers prefix="arrow" />

        {layout.routedEdges.map(({ from, to, pathD }) => {
          const edgeKey = `${from}->${to}`;
          const fromRole = highlights[from];
          const toRole = highlights[to];
          const isPreview = deletionPreview.includes(edgeKey);
          const isEdgeSelected = !draggedTaskId && selectedEdgeKeys.includes(edgeKey);

          let strokeColor = '#94a3b8';
          let strokeWidth = 1.85;
          let marker = 'url(#arrow-default)';

          const isPredEdge =
            (fromRole === 'predecessor-direct' ||
              fromRole === 'predecessor-transitive') &&
            (toRole === 'selected' ||
              toRole === 'predecessor-direct' ||
              toRole === 'predecessor-transitive');

          const isSuccEdge =
            (fromRole === 'selected' ||
              fromRole === 'successor-direct' ||
              fromRole === 'successor-transitive') &&
            (toRole === 'successor-direct' ||
              toRole === 'successor-transitive');

          if (isPreview || isEdgeSelected) {
            strokeColor = '#e11d48'; // Rose-600
            strokeWidth = 2.8;
            marker = 'url(#arrow-selected)';
          } else if (isPredEdge) {
            strokeColor = '#d97706'; // Amber-600
            strokeWidth = 2.6;
            marker = 'url(#arrow-pred)';
          } else if (isSuccEdge) {
            strokeColor = '#9333ea'; // Purple-600
            strokeWidth = 2.6;
            marker = 'url(#arrow-succ)';
          }

          return (
            <g
              key={edgeKey}
              data-edge-key={edgeKey}
              data-deletion-preview={isPreview || undefined}
              className="group pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge(edgeKey, e, layout.orderedEdgeKeys);
              }}
            >
              {/* Wide invisible click hit-area so clicking edges is effortless */}
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
              />
              {isEdgeSelected && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#fda4af"
                  strokeWidth={7}
                  opacity={0.65}
                  strokeLinecap="round"
                />
              )}
              <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                markerEnd={marker}
                className="group-hover:stroke-[2.8px]"
              />
            </g>
          );
        })}
      </svg>

      {/* Task Nodes */}
      {Object.values(layout.nodes).map(({ task, x, y, width, height }) => {
        const role: HighlightRole = highlights[task.id] ?? null;
        const dropKey = `net-task:${task.id}`;
        const isDropTarget =
          activeDropTargetKey === dropKey && draggedTaskId !== task.id;
        const isBeingDragged = draggedTaskId === task.id;

        const appearance = taskAppearanceRole(task, role, isDropTarget, isShiftDrag);

        let containerClasses =
          'bg-white border-slate-200/90 shadow-sm hover:border-slate-300';

        if (appearance === 'drop') {
          containerClasses = 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-md';
        } else if (appearance === 'selected') {
          containerClasses =
            'bg-sky-100/95 border-sky-500 ring-2 ring-sky-400/35 shadow-sm';
        } else if (appearance === 'predecessor') {
          containerClasses =
            'bg-amber-100/90 border-amber-500 ring-2 ring-amber-400/30 shadow-sm';
        } else if (appearance === 'successor') {
          containerClasses =
            'bg-purple-100/90 border-purple-500 ring-2 ring-purple-400/30 shadow-sm';
        } else if (appearance === 'active') {
          containerClasses =
            'bg-emerald-100/95 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm';
        } else if (appearance === 'deemphasized') {
          containerClasses =
            'bg-white/75 border-slate-200/70 opacity-80 hover:opacity-100';
        }

        return (
          <div
            key={task.id}
            data-dependency-highlight={role?.startsWith('predecessor-') ? 'predecessor' : role?.startsWith('successor-') ? 'successor' : undefined}
            style={{
              left: x,
              top: y,
              width,
              height,
            }}
            {...taskInteractions(task.id, dropKey, props)}
            draggable={titleEditor.taskId !== task.id && dateEditor.taskId !== task.id}
            className={`absolute z-20 rounded-xl border px-2.5 py-2 flex flex-col justify-between cursor-pointer transition-colors ${containerClasses} ${
              isBeingDragged ? 'opacity-35' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <TaskDragHandle />
                {task.predecessorIds.length === 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleActive(task);
                    }}
                    className={`p-0.5 rounded border ${
                      task.isActive
                        ? 'bg-emerald-500 text-white border-emerald-600'
                        : 'bg-slate-100 border-slate-200 text-slate-400 hover:text-emerald-600'
                    }`}
                  >
                    <Flame className="w-3 h-3" />
                  </button>
                )}
                <span
                  className={`font-mono text-[11px] px-1.5 py-0.2 rounded border shrink-0 ${
                    task.isActive
                      ? 'bg-emerald-200/70 border-emerald-400 text-emerald-900 font-semibold'
                      : role === 'selected'
                      ? 'bg-sky-200/70 border-sky-400 text-sky-950 font-semibold'
                      : 'bg-slate-100 border-slate-200 text-slate-600'
                  }`}
                >
                  {task.id}
                </span>
              </div>

               <TaskDate task={task} editor={dateEditor} compact />
            </div>

            <div className="text-xs font-medium text-slate-900 truncate pl-1">
              <TaskTitle task={task} editor={titleEditor} className="block truncate" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
