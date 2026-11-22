import { FilteredEdgeStubs } from './FilteredEdgeStubs';
import { TaskProgressLine } from './TaskProgressLine';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, GripVertical } from 'lucide-react';
import {
  computeTransitiveReductionEdges,
  dateKeyToIsoStart,
  formatDateHeading,
  toDateKey,
} from '../domain/projector';
import type { HighlightRole, TaskState } from '../domain/types';
import { DateLayerLine } from './DateLayerLine';
import { DateScrollOverlay } from './DateScrollOverlay';
import { TaskTitle } from './TaskTitle';
import type { InlineEditor } from './inlineEditor';
import { taskAppearanceRole } from './taskAppearance';
import { TaskDate } from './TaskDate';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import { taskInteractions, draggedTaskIdOf } from './taskInteractions';
import type { TaskViewInteractions } from './taskInteractions';
import { edgesWithPreview } from '../domain/dependencyPaths';
import { formatMarkerTime } from '../domain/timeMarkers';
import { layoutNetworkLanes } from './networkLanes';
import { refineNetworkPositions } from './networkRefinement';
import { TaskDragHandle } from './TaskDragHandle';
import { arrowBase, ArrowMarkers } from './arrowGeometry';
import { type Cubic, pathData, pointOnCurve } from './networkCrossings';
import { t, useLanguage } from '../i18n';

interface NetworkPlanViewProps extends TaskViewInteractions {
  projectFilterActive?: boolean;
  projectOrder?: readonly string[];
  projectMembers?: ReadonlyMap<string, ReadonlySet<string>>;
  scrollRef?: React.RefObject<HTMLElement>;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
  openTasks: TaskState[];
  now: Date;
  hideEmptyDates?: boolean;
}

interface PositionedNode {
  task: TaskState;
  x: number; // Top-left X
  y: number; // Top-left Y
  cx: number; // Center X
  cy: number; // Center Y
  width: number;
  height: number;
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
 * One cubic Bézier with a direction-dependent target tangent and a small bow for aligned
 * endpoints. Obstacles may adjust its curvature, but never add waypoints.
 */
function buildEdgeCurve(
  startPt: { x: number; y: number },
  endPt: { x: number; y: number },
  hitsObstacle: ((x: number, y: number) => boolean) | undefined,
  direction = { x: 0, y: 1 }
): Cubic {
  endPt = arrowBase(endPt, direction);
  const dx = endPt.x - startPt.x;
  const deltaY = endPt.y - startPt.y;
  // A 36-unit control offset bows a vertical edge by at most 16 SVG units.
  const bowX = direction.x === 0 ? (dx < 0 ? -1 : 1) * Math.max(0, 36 - Math.abs(dx)) : 0;
  const bowY = direction.y === 0 ? (deltaY < 0 ? -1 : 1) * Math.max(0, 36 - Math.abs(deltaY)) : 0;
  let bestCurve: Cubic = [startPt, startPt, endPt, endPt];
  let bestScore = Infinity;
  for (const factor of [0.42, 0.28, 0.56]) {
    const distance = Math.max(8, Math.abs(direction.x === 0 ? deltaY : dx) * factor);
    const startControlX = startPt.x + direction.x * distance + bowX;
    const startControlY = startPt.y + direction.y * distance + bowY;
    const endControlX = endPt.x - direction.x * distance;
    const endControlY = endPt.y - direction.y * distance;
    const curve: Cubic = [startPt, { x: startControlX, y: startControlY }, { x: endControlX, y: endControlY }, endPt];
    let score = factor === 0.42 ? 0 : 0.25;
    // Choose the curvature with the fewest samples near intervening cards.
    for (let i = 1; hitsObstacle && i < 24; i++) {
      const { x, y } = pointOnCurve(curve, i / 24);
      if (hitsObstacle(x, y)) score++;
    }
    if (score < bestScore) {
      bestScore = score;
      bestCurve = curve;
    }
    if (bestScore === 0) break;
  }
  return bestCurve;
}

type Obstacle = Pick<PositionedNode, 'x' | 'y' | 'width' | 'height'>;

function nearCard(x: number, y: number, card: Obstacle) {
  return x >= card.x - 8 && x <= card.x + card.width + 8 &&
    y >= card.y - 5 && y <= card.y + card.height + 5;
}

export function buildCleanEdgePath(
  start: { x: number; y: number }, end: { x: number; y: number },
  obstacles: Obstacle[], direction = { x: 0, y: 1 },
) {
  const hit = obstacles.length ? (x: number, y: number) => obstacles.some(card => nearCard(x, y, card)) : undefined;
  return pathData(buildEdgeCurve(start, end, hit, direction));
}

// The time bands and lane placement belong only to the network view.
export function NetworkPlanView(props: NetworkPlanViewProps) {
  const language = useLanguage();
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
    isAltDrag,
    activeDropTargetKey,
    setActiveDropTargetKey,
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

    // A physical row belongs to one date and one time slot. Active cards share
    // a separate slot before today's first marker, independent of manual order.
    const days = new Map<string, Map<number, TaskState[]>>();
    if (!props.hideEmptyDates) days.set(todayKey, new Map());
    for (const task of openTasks) {
      const date = task.isActive || task.effectiveDateKey < todayKey ? todayKey : task.effectiveDateKey;
      const slot = task.isActive ? -1 : task.sortSlot ?? 0;
      let day = days.get(date);
      if (!day) days.set(date, day = new Map());
      const area = day.get(slot);
      if (area) area.push(task);
      else day.set(slot, [task]);
    }
    const sortedDates = [...days.keys()].sort();
    const areas = sortedDates.flatMap(date =>
      [...days.get(date)!].sort(([a], [b]) => a - b).map(([slot, tasks]) => ({ date, slot, tasks }))
    );

    const usableWidth = Math.max(NODE_WIDTH, containerWidth - LEFT_DATE_GUTTER - CANVAS_PAD_X);
    const pitch = NODE_WIDTH + NODE_SEP_X;
    const laneCount = Math.max(1, Math.floor((usableWidth + NODE_SEP_X) / pitch));
    const laneWidth = (usableWidth + NODE_SEP_X) / laneCount;
    const projectRank = new Map(props.projectOrder?.map((id, index) => [id, index]));
    const firstProject = (task: TaskState) => {
      let first = Infinity;
      for (const id of props.projectMembers?.get(task.id) ?? []) {
        first = Math.min(first, projectRank.get(id) ?? Infinity);
      }
      return first;
    };

    // Stable accumulation order also keeps floating-point relaxation independent of list edits.
    const reducedEdges = computeTransitiveReductionEdges(openTasks)
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const areaRows = layoutNetworkLanes(areas.map(area => area.tasks), laneCount, reducedEdges, firstProject);
    const nodes: Record<string, PositionedNode> = {};
    const dateBands: DateBandLayout[] = [];
    const timeLabels: { y: number; minute: number }[] = [];
    let currentY = CANVAS_PAD_Y;
    let areaIndex = 0;
    for (const dateKey of sortedDates) {
      const bandTopY = currentY;
      let nextRowY = bandTopY + 24;
      while (areaIndex < areas.length && areas[areaIndex].date === dateKey) {
        const { slot } = areas[areaIndex];
        if (slot > 0) timeLabels.push({ y: nextRowY, minute: slot });
        for (const row of areaRows[areaIndex]) {
          for (const { task, lane } of row) {
            const x = LEFT_DATE_GUTTER + lane * laneWidth + (laneWidth - pitch) / 2;
            nodes[task.id] = {
              task, x, y: nextRowY, cx: x + NODE_WIDTH / 2, cy: nextRowY + NODE_HEIGHT / 2,
              width: NODE_WIDTH, height: NODE_HEIGHT,
            };
          }
          nextRowY += NODE_HEIGHT + SUBROW_SEP_Y;
        }
        areaIndex++;
      }
      currentY = days.get(dateKey)!.size
        ? nextRowY - SUBROW_SEP_Y + RANK_SEP_Y
        : bandTopY + 38;
      dateBands.push({
        ...formatDateHeading(dateKey, now), dateKey, isoDate: dateKeyToIsoStart(dateKey),
        bandTopY, bandHeight: currentY - bandTopY,
      });
    }

    const allNodes = Object.values(nodes);
    const physicalRows = areaRows.flat().map(row => row.map(item => item.task));
    const rowIndex = new Map<string, number>(), columnIndex = new Map<string, number>();
    physicalRows.forEach((row, r) => row.forEach(({ id }, c) => {
      rowIndex.set(id, r);
      columnIndex.set(id, c);
    }));
    const rowTops = physicalRows.map(row => nodes[row[0].id].y);
    // Only one physical row can reach a sampled Y. X coordinates can change on each trial.
    const hitsBetween = (first: number, last: number) => (x: number, y: number) => {
      let lo = first, hi = last + 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rowTops[mid] + NODE_HEIGHT + 5 < y) lo = mid + 1;
        else hi = mid;
      }
      return lo <= last && rowTops[lo] - 5 <= y &&
        physicalRows[lo].some(task => nearCard(x, y, nodes[task.id]));
    };
    const route = (edge: { from: string; to: string }) => {
      const fromNode = nodes[edge.from], toNode = nodes[edge.to];
      const sameRow = fromNode.y === toNode.y;
      // A side-to-side route cannot clear a card between its endpoints in this
      // row. Use the open strip above the row and meet both top borders normally.
      if (sameRow && Math.abs(columnIndex.get(edge.from)! - columnIndex.get(edge.to)!) > 1) {
        const y = fromNode.y;
        const top = y - SUBROW_SEP_Y;
        return [
          { x: fromNode.cx, y }, { x: fromNode.cx, y: top },
          { x: toNode.cx, y: top }, arrowBase({ x: toNode.cx, y }, { x: 0, y: 1 }),
        ] satisfies Cubic;
      }
      const direction = sameRow
        ? { x: toNode.cx > fromNode.cx ? 1 : -1, y: 0 }
        : { x: 0, y: toNode.cy > fromNode.cy ? 1 : -1 };
      const startPt = {
        x: fromNode.cx + direction.x * fromNode.width / 2,
        y: fromNode.cy + direction.y * fromNode.height / 2,
      };
      const endPt = {
        x: toNode.cx - direction.x * toNode.width / 2,
        y: toNode.cy - direction.y * toNode.height / 2,
      };

      const a = rowIndex.get(edge.from)!, b = rowIndex.get(edge.to)!;
      const hit = Math.abs(a - b) > 1 ? hitsBetween(Math.min(a, b) + 1, Math.max(a, b) - 1) : undefined;
      return buildEdgeCurve(startPt, endPt, hit, direction);
    };
    const visible = (edge: { from: string; to: string }) => !!nodes[edge.from] && !!nodes[edge.to];
    refineNetworkPositions(physicalRows, nodes, reducedEdges, route,
      LEFT_DATE_GUTTER, LEFT_DATE_GUTTER + usableWidth, NODE_SEP_X);
    const routedEdges: RoutedEdge[] = edgesWithPreview(reducedEdges, openTasks, deletionPreview)
      .filter(visible).map(edge => ({ ...edge, pathD: pathData(route(edge)) }));

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
      timeLabels,
      routedEdges,
      orderedEdgeKeys,
      orderedTaskIds: physicalRows.flatMap(row => row.map(task => task.id)),
      canvasWidth,
      canvasHeight,
    };
  }, [openTasks, now, props.hideEmptyDates, props.projectOrder, props.projectMembers, containerWidth, deletionPreview.join('|'), language]);

  const interactions = { ...props, orderedTaskIds: layout.orderedTaskIds };
  const dateMarkers = useMemo(() => layout.dateBands.map(band => ({ dateKey: band.dateKey, offset: band.bandTopY })), [layout.dateBands]);
  const renderDateBand = (band: DateBandLayout, overlay = false) => {
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
            className={overlay ? undefined : 'absolute left-0 right-0'}
            style={overlay ? undefined : { top: band.bandTopY, height: band.bandHeight }}
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
              const tId = draggedTaskIdOf(e, draggedTaskId);
              if (tId) {
                onSetConfiguredDate(tId, band.isoDate, band.dateKey);
              }
            }}
          />
        );

  };

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
      <DateScrollOverlay scrollRef={props.scrollRef} contentRef={containerRef} dates={dateMarkers}
        height={28} contentHeight={layout.canvasHeight}
        renderDate={dateKey => renderDateBand(layout.dateBands.find(band => band.dateKey === dateKey)!, true)} />
      {layout.dateBands.map(band => renderDateBand(band))}
      {layout.timeLabels.map(({ y, minute }) => (
        <span key={y} className="absolute left-2 pointer-events-none font-mono text-xs text-slate-500"
          style={{ top: y }}>{formatMarkerTime(minute)}</span>
      ))}

      {/* SVG Layer for Clean, Direct Directed Edges (Multi-Selectable with Ctrl/Shift & Deletable via Del/Backspace) */}
      <svg
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        className="absolute inset-0 pointer-events-none z-10"
      >
        <ArrowMarkers prefix="arrow" />
        {props.projectFilterActive && <FilteredEdgeStubs nodes={Object.values(layout.nodes)} visible={new Set(props.openTasks.map(task => task.id))} vertical marker="arrow"/>}

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

        const appearance = taskAppearanceRole(task, role, isDropTarget, isAltDrag);

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
            {...taskInteractions(task.id, dropKey, interactions)}
            data-task-drag-disabled={titleEditor.taskId === task.id || dateEditor.taskId === task.id || undefined}
            className={`absolute z-20 rounded-xl border px-2.5 py-2 flex flex-col justify-between cursor-pointer transition-colors ${containerClasses} ${
              isBeingDragged ? 'opacity-35' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 min-w-0">
                <TaskDragHandle />
                <button
                  type="button"
                  aria-label={task.isActive ? t('Deaktivieren (Space)') : t('Aktivieren (Space)')}
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

              <div className="flex items-center gap-1 shrink-0">
                <TaskChecklistBadge progress={task.checklistProgress} compact />
                <TaskDate task={task} editor={dateEditor} compact />
              </div>
            </div>

            <div className="text-xs font-medium text-slate-900 truncate pl-1">
              <TaskProgressLine task={task} />
              <TaskTitle task={task} editor={titleEditor} className="block truncate" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
