import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, GripVertical } from 'lucide-react';
import {
  computeTransitiveReductionEdges,
  dateKeyToIsoStart,
  formatDateHeading,
  formatIso8601Display,
  toDateKey,
} from '../domain/projector';
import { HighlightRole, TaskState } from '../domain/types';
import { DateLayerLine } from './DateLayerLine';
import { TaskTitle, TitleEditor } from './TaskTitle';
import { taskInteractions } from './taskInteractions';
import { edgesWithPreview } from '../domain/dependencyPaths';
import { TaskDragHandle } from './TaskDragHandle';

interface NetworkPlanViewProps {
  deletionPreview: string[];
  titleEditor: TitleEditor;
  openTasks: TaskState[];
  now: Date;
  selectedTaskId: string | null;
  selectedEdgeKeys: string[];
  onSelectEdge: (
    edgeKey: string,
    e: React.MouseEvent,
    orderedEdgeKeys: string[]
  ) => void;
  onClearEdgeSelection: () => void;
  highlights: Record<string, HighlightRole>;
  draggedTaskId: string | null;
  isShiftDrag: boolean;
  onShiftKeyChange: (shift: boolean) => void;
  activeDropTargetKey: string | null;
  setActiveDropTargetKey: (key: string | null) => void;
  setDraggedTaskId: (id: string | null) => void;
  onSelectTask: (taskId: string) => void;
  onContextMenuTask: (e: React.MouseEvent, taskId: string) => void;
  onDragStartTask: (e: React.DragEvent, taskId: string) => void;
  onDragEndTask: () => void;
  onAddPredecessor: (draggedId: string, targetTaskId: string) => void;
  onRemoveDependencyBetween: (draggedId: string, targetTaskId: string) => void;
  onSetConfiguredDate: (
    taskId: string,
    isoDate: string,
    humanLabel: string
  ) => void;
  onToggleActive: (task: TaskState) => void;
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

const NODE_WIDTH = 188;
const NODE_HEIGHT = 56;
const NODE_SEP_X = 16; // Compact horizontal gap between side-by-side nodes
const SUBROW_SEP_Y = 20; // Vertical gap between wrapped rows within the same day
const RANK_SEP_Y = 36; // Reduced vertical gap between date layers
const LEFT_DATE_GUTTER = 136;
const CANVAS_PAD_X = 16;
const CANVAS_PAD_Y = 18;

/**
 * Checks if the line segment (x1, y1) -> (x2, y2) intersects the padded rectangle [left, right] x [top, bottom].
 */
function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): boolean {
  // Sample along the segment between top and bottom Y of the box
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxY < top || minY > bottom) return false;

  const dy = y2 - y1;
  if (Math.abs(dy) < 1e-6) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    return maxX >= left && minX <= right && y1 >= top && y1 <= bottom;
  }

  // Evaluate X at the top, center, and bottom of the box
  const checkYs = [
    Math.max(minY, top),
    (Math.max(minY, top) + Math.min(maxY, bottom)) / 2,
    Math.min(maxY, bottom),
  ];

  for (const y of checkYs) {
    const t = (y - y1) / dy;
    if (t >= 0 && t <= 1) {
      const x = x1 + t * (x2 - x1);
      if (x >= left && x <= right) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Builds a clean, direct SVG curve from startPt to endPt.
 * - If no intermediate node blocks the direct line, draws a single smooth vertical S-curve (or straight line).
 * - Only if an intermediate node sits directly in the way, routes cleanly through the gap beside that obstacle.
 */
function buildCleanEdgePath(
  startPt: { x: number; y: number },
  endPt: { x: number; y: number },
  intermediateObstacles: PositionedNode[]
): string {
  const padX = 8;
  const padY = 5;

  // Check if any intermediate node actually blocks the direct path
  const blockingNodes = intermediateObstacles
    .filter((obs) =>
      segmentIntersectsBox(
        startPt.x,
        startPt.y,
        endPt.x,
        endPt.y,
        obs.x - padX,
        obs.y - padY,
        obs.x + obs.width + padX,
        obs.y + obs.height + padY
      )
    )
    .sort((a, b) => a.cy - b.cy);

  if (blockingNodes.length === 0) {
    // Direct, clean vertical S-curve without any detours!
    const dy = (endPt.y - startPt.y) * 0.42;
    return `M ${startPt.x} ${startPt.y} C ${startPt.x} ${
      startPt.y + dy
    }, ${endPt.x} ${endPt.y - dy}, ${endPt.x} ${endPt.y}`;
  }

  // Only when an intermediate node actually sits in the way: route around its nearest side
  const waypoints: Array<{ x: number; y: number }> = [startPt];

  for (const obs of blockingNodes) {
    const prevPt = waypoints[waypoints.length - 1];
    const t = (obs.cy - prevPt.y) / Math.max(1, endPt.y - prevPt.y);
    const lineXAtObs = prevPt.x + t * (endPt.x - prevPt.x);

    const leftPassX = obs.x - 10;
    const rightPassX = obs.x + obs.width + 10;

    const passX =
      Math.abs(lineXAtObs - leftPassX) <= Math.abs(rightPassX - lineXAtObs)
        ? leftPassX
        : rightPassX;

    waypoints.push({ x: passX, y: obs.cy });
  }

  waypoints.push(endPt);

  // Smooth cubic spline through waypoints
  let d = `M ${waypoints[0].x} ${waypoints[0].y}`;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];

    const tension = 0.2;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function NetworkPlanView({
  openTasks,
  now,
  selectedTaskId,
  selectedEdgeKeys,
  onSelectEdge,
  onClearEdgeSelection,
  highlights,
  draggedTaskId,
  isShiftDrag,
  onShiftKeyChange,
  activeDropTargetKey,
  setActiveDropTargetKey,
  setDraggedTaskId,
  onSelectTask,
  onContextMenuTask,
  onDragStartTask,
  onDragEndTask,
  onAddPredecessor,
  onRemoveDependencyBetween,
  onSetConfiguredDate,
  onToggleActive,
  titleEditor,
  deletionPreview,
}: NetworkPlanViewProps) {
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

    // Build adjacency lookup on reduced edges for Barycenter crossing minimization
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

    // Preserve the shared topological order; horizontal alignment must not reorder nodes.
    for (const row of rows) {
      const index = new Map(openTasks.map((task,index) => [task.id,index]));
      row.sort((a,b) => index.get(a.id)!-index.get(b.id)!);
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

    // 4. Sugiyama Barycenter Crossing Minimization + Clamped Horizontal Parent-Child Alignment
    const xPos: Record<string, number> = {};

    // Assign initial X positions wrapped by maxCols
    for (const row of rows) {
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

    const resolveRowPositions = (
      row: TaskState[],
      desiredX: Record<string, number>
    ) => {
      if (row.length === 0) return;
      const currentIdx = new Map<string, number>();
      row.forEach((t, i) => currentIdx.set(t.id, i));

      // Sort all tasks in the day by their desired horizontal Barycenter X
      // No local barycenter ordering: all views use the same stable topological core.

      // Resolve positions per sub-row of up to maxCols tasks so each sub-row stays within containerWidth
      for (let start = 0; start < row.length; start += maxCols) {
        const slice = row.slice(start, start + maxCols);
        resolveSlicePositions(slice, desiredX);
      }
    };

    // Perform 6 top-down & bottom-up Barycenter sweeps so connected nodes align vertically without crossings!
    for (let iter = 0; iter < 6; iter++) {
      // Top-Down: align children directly under the average X of their predecessors
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
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
        resolveRowPositions(row, desired);
      }

      // Bottom-Up: align parents directly above the average X of their successors
      for (let r = rows.length - 2; r >= 0; r--) {
        const row = rows[r];
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
        resolveRowPositions(row, desired);
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

      const rowTasks = rows[r];
      const isRowEmpty = rowTasks.length === 0;
      const numSubRows = isRowEmpty
        ? 0
        : Math.ceil(rowTasks.length / maxCols);

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

      rowTasks.forEach((t, idx) => {
        const subRow = Math.floor(idx / maxCols);
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
      });
    }

    // 6. Route clean, direct edges (only bending if an intermediate node actually blocks the straight path)
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
      onClick={() => {
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
        <defs>
          <marker
            id="arrow-default"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94a3b8" />
          </marker>
          <marker
            id="arrow-pred"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d97706" />
          </marker>
          <marker
            id="arrow-succ"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#9333ea" />
          </marker>
          <marker
            id="arrow-selected"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48" />
          </marker>
        </defs>

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
                className="transition-all group-hover:stroke-[2.8px]"
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
        const confDisplay = formatIso8601Display(task.configuredStart);

        let containerClasses =
          'bg-white border-slate-200/90 shadow-sm hover:border-slate-300';

        if (isDropTarget && !isShiftDrag) {
          containerClasses = isShiftDrag
            ? 'bg-rose-50 border-rose-500 ring-2 ring-rose-400/35 shadow-md'
            : 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-md';
        } else if (role === 'selected') {
          containerClasses =
            'bg-sky-100/95 border-sky-500 ring-2 ring-sky-400/35 shadow-sm';
        } else if (
          role === 'predecessor-direct' ||
          role === 'predecessor-transitive'
        ) {
          containerClasses =
            'bg-amber-100/90 border-amber-500 ring-2 ring-amber-400/30 shadow-sm';
        } else if (
          role === 'successor-direct' ||
          role === 'successor-transitive'
        ) {
          containerClasses =
            'bg-purple-100/90 border-purple-500 ring-2 ring-purple-400/30 shadow-sm';
        } else if (task.isActive) {
          containerClasses =
            'bg-emerald-100/95 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm';
        } else if (task.isDeemphasized) {
          containerClasses =
            'bg-white/75 border-slate-200/70 opacity-60 hover:opacity-90';
        }

        return (
          <div
            key={task.id}
            style={{
              left: x,
              top: y,
              width,
              height,
            }}
            {...taskInteractions(task.id, dropKey, {onSelectTask,onDragStartTask,onDragEndTask,onShiftKeyChange,isShiftDrag,draggedTaskId,setDraggedTaskId,setActiveDropTargetKey,onAddPredecessor,onRemoveDependencyBetween,onContextMenuTask})}
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

              <span className="text-[10px] font-mono text-slate-500 shrink-0">
                {confDisplay.isoText}
              </span>
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
