import React, { useMemo, useState } from 'react';
import { futureLimit, localDate } from '../domain/dates';
import { Flame, GripVertical } from 'lucide-react';
import {
  computeTransitiveReductionEdges,
  dateKeyToIsoStart,
  formatDateHeading,
  formatIso8601Display,
  toDateKey,
} from '../domain/projector';
import { HighlightRole, ListEntry, TaskState } from '../domain/types';
import { TaskTitle, TitleEditor } from './TaskTitle';
import { taskInteractions } from './taskInteractions';

interface GanttViewProps {
  titleEditor: TitleEditor;
  openTasks: TaskState[];
  listEntries: ListEntry[];
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

interface CalendarDayCol {
  dateKey: string;
  isoDate: string;
  weekdayShort: string;
  isToday: boolean;
  isWeekend: boolean;
  colIndex: number;
  x: number;
  width: number;
}

interface GanttBarItem {
  task: TaskState;
  rowIndex: number;
  colIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

const LEFT_LIST_WIDTH = 248;
const NODE_WIDTH = 50; // Compact width for just the ID (e.g. "26-109")
const CHANNEL_WIDTH = 42; // Horizontal space between columns for parallel vertical arrow lanes
const DAY_COL_WIDTH = NODE_WIDTH + CHANNEL_WIDTH; // 92px per calendar day
const NODE_OFFSET_X = 6; // Left offset of node inside its day column
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 42;
const NODE_HEIGHT = 26;

/**
 * Builds an orthogonal path with rounded corners from `(startX, startY)`
 * via vertical lane `laneX` to `(endX, endY)`.
 */
function buildChannelGanttPath(
  startX: number,
  startY: number,
  laneX: number,
  endX: number,
  endY: number
): string {
  if (Math.abs(endY - startY) < 1.5) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const r = Math.min(
    5,
    Math.abs(endY - startY) / 2,
    Math.max(2, Math.abs(laneX - startX) / 2),
    Math.max(2, Math.abs(endX - laneX) / 2)
  );
  const dirY = endY >= startY ? 1 : -1;

  return [
    `M ${startX} ${startY}`,
    `L ${laneX - r} ${startY}`,
    `Q ${laneX} ${startY} ${laneX} ${startY + dirY * r}`,
    `L ${laneX} ${endY - dirY * r}`,
    `Q ${laneX} ${endY} ${laneX + r} ${endY}`,
    `L ${endX} ${endY}`,
  ].join(' ');
}

export function GanttView({
  openTasks,
  listEntries,
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
}: GanttViewProps) {
  const [windowStart, setWindowStart] = useState(() => toDateKey(now));
  const layout = useMemo(() => {
    const todayKey = toDateKey(now);

    // A bounded, navigable 42-day window; legacy dates never expand the axis.
    const calendarDays: CalendarDayCol[] = [];
    const dateKeyToCol = new Map<string, number>();

    const [sy, sm, sd] = windowStart.split('-').map(Number);
    const cur = new Date(sy, (sm || 1) - 1, sd || 1);

    let colIdx = 0;
    while (colIdx < 42 && cur <= futureLimit(now)) {
      const dk = toDateKey(cur);
      const { isToday, isWeekend, weekdayShort } = formatDateHeading(dk, now);
      calendarDays.push({
        dateKey: dk,
        isoDate: dateKeyToIsoStart(dk),
        weekdayShort,
        isToday,
        isWeekend,
        colIndex: colIdx,
        x: LEFT_LIST_WIDTH + colIdx * DAY_COL_WIDTH,
        width: DAY_COL_WIDTH,
      });
      dateKeyToCol.set(dk, colIdx);
      colIdx += 1;
      cur.setDate(cur.getDate() + 1);
    }

    // Extract topologically ordered tasks from listEntries so predecessors appear above successors
    const orderedTasks: TaskState[] = [];
    const seen = new Set<string>();
    for (const entry of listEntries) {
      if (entry.kind === 'task') {
        orderedTasks.push(entry.task);
        seen.add(entry.task.id);
      }
    }
    for (const t of openTasks) {
      if (!seen.has(t.id)) {
        orderedTasks.push(t);
      }
    }

    const bars: Record<string, GanttBarItem> = {};
    const barList: GanttBarItem[] = [];

    orderedTasks.forEach((task, rIdx) => {
      const effKey =
        task.effectiveDateKey < todayKey ? todayKey : task.effectiveDateKey;
      const cIdx = dateKeyToCol.get(effKey);
      if (cIdx === undefined) return;

      const x = LEFT_LIST_WIDTH + cIdx * DAY_COL_WIDTH + NODE_OFFSET_X;
      const y =
        HEADER_HEIGHT + rIdx * ROW_HEIGHT + (ROW_HEIGHT - NODE_HEIGHT) / 2;
      const width = NODE_WIDTH;
      const height = NODE_HEIGHT;

      const item: GanttBarItem = {
        task,
        rowIndex: rIdx,
        colIndex: cIdx,
        x,
        y,
        width,
        height,
        cx: x + width / 2,
        cy: y + height / 2,
      };
      bars[task.id] = item;
      barList.push(item);
    });

    // Compute transitive-reduced edges & assign non-overlapping vertical arrow lanes + exit/entry Y ports
    const reducedEdges = computeTransitiveReductionEdges(openTasks).filter(
      (e) => Boolean(bars[e.from] && bars[e.to])
    );

    // 1. Group outgoing edges per source node to spread exit Y ports slightly
    const outgoingBySource: Record<string, Array<{ from: string; to: string }>> =
      {};
    // 2. Group incoming edges per target node to spread entry Y ports slightly
    const incomingByTarget: Record<string, Array<{ from: string; to: string }>> =
      {};
    // 3. Group edges by their vertical routing channel (the gap immediately after `fromBar.colIndex`)
    const edgesByChannel: Record<number, Array<{ from: string; to: string }>> =
      {};

    for (const edge of reducedEdges) {
      if (!outgoingBySource[edge.from]) outgoingBySource[edge.from] = [];
      outgoingBySource[edge.from].push(edge);

      if (!incomingByTarget[edge.to]) incomingByTarget[edge.to] = [];
      incomingByTarget[edge.to].push(edge);

      const channelCol = bars[edge.from].colIndex;
      if (!edgesByChannel[channelCol]) edgesByChannel[channelCol] = [];
      edgesByChannel[channelCol].push(edge);
    }

    const startYByEdgeKey: Record<string, number> = {};
    for (const [fromId, edges] of Object.entries(outgoingBySource)) {
      const fromBar = bars[fromId];
      edges.sort((a, b) => bars[a.to].rowIndex - bars[b.to].rowIndex);
      edges.forEach((e, idx) => {
        const offset = (idx - (edges.length - 1) / 2) * 4;
        startYByEdgeKey[`${e.from}->${e.to}`] = Math.max(
          fromBar.y + 4,
          Math.min(fromBar.y + fromBar.height - 4, fromBar.cy + offset)
        );
      });
    }

    const endYByEdgeKey: Record<string, number> = {};
    for (const [toId, edges] of Object.entries(incomingByTarget)) {
      const toBar = bars[toId];
      edges.sort((a, b) => bars[a.from].rowIndex - bars[b.from].rowIndex);
      edges.forEach((e, idx) => {
        const offset = (idx - (edges.length - 1) / 2) * 4;
        endYByEdgeKey[`${e.from}->${e.to}`] = Math.max(
          toBar.y + 4,
          Math.min(toBar.y + toBar.height - 4, toBar.cy + offset)
        );
      });
    }

    // Assign a distinct vertical lane X inside each column gap:
    // "Du musst nur die Pfeile die am weitesten Oben nach rechts gehen, ganz rechts routen."
    const laneXByEdgeKey: Record<string, number> = {};
    for (const [colStr, edges] of Object.entries(edgesByChannel)) {
      const cIdx = Number(colStr);
      // Sort edges by target row ascending (the row where the arrow turns right), then source row ascending
      edges.sort((a, b) => {
        const targetDiff = bars[a.to].rowIndex - bars[b.to].rowIndex;
        if (targetDiff !== 0) return targetDiff;
        return bars[a.from].rowIndex - bars[b.from].rowIndex;
      });

      const channelStartX =
        LEFT_LIST_WIDTH + cIdx * DAY_COL_WIDTH + NODE_OFFSET_X + NODE_WIDTH + 6;
      const channelEndX =
        LEFT_LIST_WIDTH + (cIdx + 1) * DAY_COL_WIDTH + NODE_OFFSET_X - 8;
      const usableWidth = Math.max(12, channelEndX - channelStartX);

      edges.forEach((e, idx) => {
        const key = `${e.from}->${e.to}`;
        if (edges.length === 1) {
          laneXByEdgeKey[key] = channelStartX + usableWidth / 2;
        } else {
          const step = Math.min(6, usableWidth / Math.max(1, edges.length - 1));
          const totalSpan = step * (edges.length - 1);
          const rightmostLane =
            channelStartX + (usableWidth - totalSpan) / 2 + totalSpan;
          // idx = 0 (highest right turn) gets rightmostLane; lower right turns sit to its left
          laneXByEdgeKey[key] = rightmostLane - idx * step;
        }
      });
    }

    const routedEdges = reducedEdges.map(({ from, to }) => {
      const key = `${from}->${to}`;
      const fromBar = bars[from];
      const toBar = bars[to];
      const startX = fromBar.x + fromBar.width;
      const startY = startYByEdgeKey[key] ?? fromBar.cy;
      const endX = toBar.colIndex === fromBar.colIndex ? toBar.x + toBar.width : toBar.x;
      const endY = endYByEdgeKey[key] ?? toBar.cy;
      const laneX =
        laneXByEdgeKey[key] ?? startX + Math.max(10, (endX - startX) / 2);

      return {
        from,
        to,
        edgeKey: key,
        pathD: buildChannelGanttPath(startX, startY, laneX, endX, endY),
      };
    });

    // Sort edges top-to-bottom for Shift+Click range selection
    routedEdges.sort((a, b) => {
      const ra = bars[a.from].rowIndex - bars[b.from].rowIndex;
      if (ra !== 0) return ra;
      return bars[a.to].rowIndex - bars[b.to].rowIndex;
    });

    const orderedEdgeKeys = routedEdges.map((e) => e.edgeKey);

    const canvasWidth = Math.max(
      760,
      LEFT_LIST_WIDTH + calendarDays.length * DAY_COL_WIDTH
    );
    const canvasHeight = Math.max(
      420,
      HEADER_HEIGHT + Math.max(orderedTasks.length, 6) * ROW_HEIGHT + 24
    );

    return {
      calendarDays,
      barList,
      bars,
      routedEdges,
      orderedEdgeKeys,
      canvasWidth,
      canvasHeight,
    };
  }, [openTasks, listEntries, now, windowStart]);

  const navigate = (days: number) => {
    const [y,m,d] = windowStart.split('-').map(Number);
    const date = localDate(y,m,d); date.setDate(date.getDate()+days);
    const today = localDate(now.getFullYear(),now.getMonth()+1,now.getDate());
    const last = futureLimit(now); last.setDate(last.getDate()-41);
    setWindowStart(toDateKey(new Date(Math.max(today.getTime(),Math.min(last.getTime(),date.getTime())))));
  };

  return (
    <div
      className="relative bg-white/80 rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden mx-auto"
      style={{
        width: layout.canvasWidth,
        minHeight: layout.canvasHeight,
      }}
      onClick={() => {
        if (selectedEdgeKeys.length > 0) onClearEdgeSelection();
      }}
    >
      {/* Left Task List Column (written-out task names stacked vertically) */}
      <div
        style={{
          left: 0,
          top: 0,
          width: LEFT_LIST_WIDTH,
          height: layout.canvasHeight,
        }}
        className="absolute z-30 bg-white/95 border-r border-slate-300"
      >
        {/* Left List Header */}
        <div
          style={{ height: HEADER_HEIGHT }}
          className="w-full border-b border-slate-300/90 bg-slate-100/85 px-3 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 select-none"
        >
          <button type="button" onClick={() => navigate(-35)} aria-label="Vorheriges Zeitfenster">&lt;</button>
          <button type="button" onClick={() => setWindowStart(toDateKey(now))} className="mx-2">Heute</button>
          <button type="button" onClick={() => navigate(35)} aria-label="Naechstes Zeitfenster">&gt;</button>
        </div>

        {/* Left List Task Rows */}
        {layout.barList.map(({ task, rowIndex }) => {
          const role: HighlightRole = highlights[task.id] ?? null;
          const dropKey = `gantt-list-task:${task.id}`;
          const isDropTarget =
            activeDropTargetKey === dropKey && draggedTaskId !== task.id;
          const isBeingDragged = draggedTaskId === task.id;

          let rowBgClasses = 'bg-white hover:bg-slate-50/90';
          if (isDropTarget) {
            rowBgClasses = isShiftDrag
              ? 'bg-rose-50 ring-1 ring-inset ring-rose-400'
              : 'bg-amber-50 ring-1 ring-inset ring-amber-400';
          } else if (role === 'selected') {
            rowBgClasses = 'bg-sky-100/85';
          } else if (
            role === 'predecessor-direct' ||
            role === 'predecessor-transitive'
          ) {
            rowBgClasses = 'bg-amber-100/75';
          } else if (
            role === 'successor-direct' ||
            role === 'successor-transitive'
          ) {
            rowBgClasses = 'bg-purple-100/75';
          } else if (task.isActive) {
            rowBgClasses = 'bg-emerald-50/90';
          }

          return (
            <div
              key={`left-row-${task.id}`}
              style={{
                top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                height: ROW_HEIGHT,
              }}
              {...taskInteractions(task.id, dropKey, {onSelectTask,onDragStartTask,onDragEndTask,onShiftKeyChange,isShiftDrag,draggedTaskId,setDraggedTaskId,setActiveDropTargetKey,onAddPredecessor,onRemoveDependencyBetween,onContextMenuTask})}
              className={`absolute left-0 right-0 px-2.5 border-b border-slate-200/60 flex items-center gap-1.5 cursor-pointer transition-colors ${rowBgClasses} ${
                isBeingDragged ? 'opacity-35' : ''
              } ${task.isDeemphasized && !role ? 'opacity-65' : ''}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0 cursor-grab" />
              {task.predecessorIds.length === 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleActive(task);
                  }}
                  className={`p-0.5 rounded border shrink-0 ${
                    task.isActive
                      ? 'bg-emerald-500 text-white border-emerald-600'
                      : 'bg-slate-100 border-slate-200 text-slate-400 hover:text-emerald-600'
                  }`}
                >
                  <Flame className="w-3 h-3" />
                </button>
              )}
              <span className="font-mono text-[10px] text-slate-500 shrink-0">
                {task.id}
              </span>
              <span
                title={task.title}
                className={`text-xs truncate min-w-0 ${
                  task.isActive
                    ? 'font-semibold text-emerald-950'
                    : 'font-medium text-slate-900'
                }`}
              >
                <TaskTitle task={task} editor={titleEditor} className="block truncate" />
              </span>
            </div>
          );
        })}
      </div>

      {/* Continuous Calendar Day Columns (Full Height Drop Zones, no dates hidden) */}
      {layout.calendarDays.map((day) => {
        const dropKey = `gantt-date:${day.dateKey}`;
        const isDropActive = activeDropTargetKey === dropKey;

        return (
          <div
            key={day.dateKey}
            style={{
              left: day.x,
              top: 0,
              width: day.width,
              height: layout.canvasHeight,
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
                onSetConfiguredDate(tId, day.isoDate, day.dateKey);
              }
            }}
            className={`absolute border-r transition-colors ${
              isDropActive
                ? 'bg-sky-100/60 border-sky-400'
                : day.isWeekend
                ? 'bg-amber-50/45 border-amber-200/70'
                : day.isToday
                ? 'bg-indigo-50/25 border-slate-200/75'
                : 'border-slate-200/60'
            }`}
          >
            {/* Compact Calendar Day Header (ISO-8601 YYYY-MM-DD + Weekday) */}
            <div
              style={{ height: HEADER_HEIGHT }}
              className={`w-full border-b px-1.5 flex flex-col justify-center items-start select-none ${
                isDropActive
                  ? 'border-sky-400 bg-sky-100/80'
                  : day.isWeekend
                  ? 'border-amber-300/90 bg-amber-100/45'
                  : day.isToday
                  ? 'border-indigo-300/90 bg-indigo-100/45'
                  : 'border-slate-300/90 bg-slate-100/75'
              }`}
            >
              <div className="flex items-center justify-between w-full gap-1">
                <span
                  className={`text-[10px] font-mono font-bold tracking-tight ${
                    day.isWeekend
                      ? 'text-amber-900'
                      : day.isToday
                      ? 'text-indigo-900'
                      : 'text-slate-700'
                  }`}
                >
                  {day.dateKey}
                </span>
                <span
                  className={`text-[9px] font-semibold px-1 py-0.1 rounded ${
                    day.isWeekend
                      ? 'bg-amber-200/80 text-amber-900'
                      : day.isToday
                      ? 'bg-indigo-200/70 text-indigo-800'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {day.weekdayShort}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Subtle Horizontal Row Grid Lines */}
      {layout.barList.map((bar) => (
        <div
          key={`row-line-${bar.task.id}`}
          style={{
            top: HEADER_HEIGHT + (bar.rowIndex + 1) * ROW_HEIGHT,
            left: LEFT_LIST_WIDTH,
            width: layout.canvasWidth - LEFT_LIST_WIDTH,
          }}
          className="absolute border-b border-slate-200/55 pointer-events-none"
        />
      ))}

      {/* SVG Layer for Non-Overlapping Vertical Lane Gantt Edges (Multi-Selectable with Ctrl/Shift & Deletable via Del/Backspace) */}
      <svg
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        className="absolute inset-0 pointer-events-none z-10"
      >
        <defs>
          <marker
            id="gantt-arrow-default"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94a3b8" />
          </marker>
          <marker
            id="gantt-arrow-pred"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d97706" />
          </marker>
          <marker
            id="gantt-arrow-succ"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#9333ea" />
          </marker>
          <marker
            id="gantt-arrow-selected"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48" />
          </marker>
        </defs>

        {layout.routedEdges.map(({ from, to, edgeKey, pathD }) => {
          const fromRole = highlights[from];
          const toRole = highlights[to];
          const isEdgeSelected = selectedEdgeKeys.includes(edgeKey);

          let strokeColor = '#94a3b8';
          let strokeWidth = 1.65;
          let marker = 'url(#gantt-arrow-default)';

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

          if (isEdgeSelected) {
            strokeColor = '#e11d48';
            strokeWidth = 2.6;
            marker = 'url(#gantt-arrow-selected)';
          } else if (isPredEdge) {
            strokeColor = '#d97706';
            strokeWidth = 2.3;
            marker = 'url(#gantt-arrow-pred)';
          } else if (isSuccEdge) {
            strokeColor = '#9333ea';
            strokeWidth = 2.3;
            marker = 'url(#gantt-arrow-succ)';
          }

          return (
            <g
              key={edgeKey}
              className="group pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge(edgeKey, e, layout.orderedEdgeKeys);
              }}
            >
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
              />
              {isEdgeSelected && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#fda4af"
                  strokeWidth={6}
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
                className="transition-all group-hover:stroke-[2.6px]"
              />
            </g>
          );
        })}
      </svg>

      {/* Compact Narrow Gantt Nodes (showing ONLY the Task ID) */}
      {layout.barList.map(({ task, x, y, width, height }) => {
        const role: HighlightRole = highlights[task.id] ?? null;
        const dropKey = `gantt-task:${task.id}`;
        const isDropTarget =
          activeDropTargetKey === dropKey && draggedTaskId !== task.id;
        const isBeingDragged = draggedTaskId === task.id;
        const confDisplay = formatIso8601Display(task.configuredStart);

        let containerClasses =
          'bg-white border-slate-300 text-slate-700 shadow-xs hover:border-slate-400';

        if (isDropTarget) {
          containerClasses = isShiftDrag
            ? 'bg-rose-50 border-rose-500 text-rose-950 ring-2 ring-rose-400/35 shadow-md'
            : 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-400/30 shadow-md';
        } else if (role === 'selected') {
          containerClasses =
            'bg-sky-100 border-sky-500 text-sky-950 font-semibold ring-2 ring-sky-400/35 shadow-sm';
        } else if (
          role === 'predecessor-direct' ||
          role === 'predecessor-transitive'
        ) {
          containerClasses =
            'bg-amber-100 border-amber-500 text-amber-950 font-semibold ring-2 ring-amber-400/30 shadow-sm';
        } else if (
          role === 'successor-direct' ||
          role === 'successor-transitive'
        ) {
          containerClasses =
            'bg-purple-100 border-purple-500 text-purple-950 font-semibold ring-2 ring-purple-400/30 shadow-sm';
        } else if (task.isActive) {
          containerClasses =
            'bg-emerald-100 border-emerald-500 text-emerald-950 font-semibold ring-2 ring-emerald-500/25 shadow-sm';
        } else if (task.isDeemphasized) {
          containerClasses =
            'bg-white/80 border-slate-200/80 text-slate-500 opacity-60 hover:opacity-90';
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
            title={`${task.id}: ${task.title} (${confDisplay.isoText})`}
            {...taskInteractions(task.id, dropKey, {onSelectTask,onDragStartTask,onDragEndTask,onShiftKeyChange,isShiftDrag,draggedTaskId,setDraggedTaskId,setActiveDropTargetKey,onAddPredecessor,onRemoveDependencyBetween,onContextMenuTask})}
            className={`absolute z-20 rounded-lg border px-1 flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors font-mono text-[11px] ${containerClasses} ${
              isBeingDragged ? 'opacity-35' : ''
            }`}
          >
            {task.id}
          </div>
        );
      })}
    </div>
  );
}
