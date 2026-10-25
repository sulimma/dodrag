import React, { useMemo } from 'react';
import { futureLimit } from '../domain/dates';
import { Flame, GripVertical } from 'lucide-react';
import {
  computeTransitiveReductionEdges,
  dateKeyToIsoStart,
  formatDateHeading,
  toDateKey,
} from '../domain/projector';
import type { HighlightRole, ListEntry, TaskState } from '../domain/types';
import { TaskTitle } from './TaskTitle';
import type { InlineEditor } from './inlineEditor';
import { taskAppearanceRole } from './taskAppearance';
import { taskInteractions } from './taskInteractions';
import type { TaskViewInteractions } from './taskInteractions';
import { edgesWithPreview } from '../domain/dependencyPaths';
import { TaskDragHandle } from './TaskDragHandle';
import { arrowBase, ArrowMarkers } from './arrowGeometry';
import { t, formatDate, useLanguage } from '../i18n';

interface GanttViewProps extends TaskViewInteractions {
  titleEditor: InlineEditor;
  listEntries: ListEntry[];
  openTasks: TaskState[];
  now: Date;
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
export function buildChannelGanttPath(
  startX: number,
  startY: number,
  laneX: number,
  endX: number,
  endY: number,
  direction = 1
): string {
  const base = arrowBase({x:endX,y:endY},{x:direction,y:0});
  endX = base.x;
  if (direction < 0) laneX = Math.max(laneX,endX+6);
  else laneX = Math.min(laneX,endX-6);
  if (Math.abs(endY - startY) < 1.5) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const r = Math.min(
    5,
    Math.abs(endY - startY) / 2,
    Math.abs(laneX - startX) / 2,
    Math.abs(endX - laneX) / 2
  );
  const dirY = endY >= startY ? 1 : -1;
  const dirStart = laneX >= startX ? 1 : -1;
  const dirEnd = endX >= laneX ? 1 : -1;

  return [
    `M ${startX} ${startY}`,
    `L ${laneX - dirStart*r} ${startY}`,
    `Q ${laneX} ${startY} ${laneX} ${startY + dirY * r}`,
    `L ${laneX} ${endY - dirY * r}`,
    `Q ${laneX} ${endY} ${laneX + dirEnd*r} ${endY}`,
    `L ${endX} ${endY}`,
  ].join(' ');
}

// Renders task dates and dependencies on a horizontal timeline.
export function GanttView(props: GanttViewProps) {
  const language = useLanguage();
  const {
    openTasks,
    listEntries,
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
    deletionPreview,
  } = props;
  const layout = useMemo(() => {
    const todayKey = toDateKey(now);

    // A bounded 42-day window starting today; legacy dates never expand the axis.
    const calendarDays: CalendarDayCol[] = [];
    const dateKeyToCol = new Map<string, number>();

    const [sy, sm, sd] = todayKey.split('-').map(Number);
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

    // Preserve list priority within the active and inactive rows.
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
    orderedTasks.sort((a, b) => Number(b.isActive) - Number(a.isActive));

    const bars: Record<string, GanttBarItem> = {};
    const barList: GanttBarItem[] = [];

    orderedTasks.forEach((task, rIdx) => {
      const effKey =
        task.isActive || task.effectiveDateKey < todayKey ? todayKey : task.effectiveDateKey;
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
    const reducedEdges = edgesWithPreview(computeTransitiveReductionEdges(openTasks),openTasks,deletionPreview).filter(
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
      // Further-left channels enter lower; within a channel, lower sources enter lower.
      edges.sort((a, b) =>
        bars[b.from].colIndex - bars[a.from].colIndex ||
        bars[a.from].rowIndex - bars[b.from].rowIndex
      );
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
      const enterRight = toBar.colIndex <= fromBar.colIndex;
      const endX = enterRight ? toBar.x + toBar.width : toBar.x;
      const endY = endYByEdgeKey[key] ?? toBar.cy;
      const laneX =
        laneXByEdgeKey[key] ?? startX + Math.max(10, (endX - startX) / 2);

      return {
        from,
        to,
        edgeKey: key,
        pathD: buildChannelGanttPath(startX, startY, laneX, endX, endY,enterRight?-1:1),
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
  }, [openTasks, listEntries, now, deletionPreview.join('|'), language]);

  const dropDay = (event: React.DragEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const listRight = root.querySelector<HTMLElement>('[data-gantt-list]')?.getBoundingClientRect().right;
    if (listRight !== undefined && event.clientX < listRight) return undefined;
    const x = event.clientX - root.getBoundingClientRect().left;
    return layout.calendarDays[Math.floor((x - LEFT_LIST_WIDTH) / DAY_COL_WIDTH)];
  };

  return (
    <div
      className="relative bg-white/80 rounded-2xl border border-slate-200/90 shadow-xs overflow-clip my-5 mx-auto"
      data-task-drop-target="gantt-calendar"
      style={{
        width: layout.canvasWidth,
        minHeight: layout.canvasHeight,
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-task-drag], [data-edge-key], button, input, textarea, [contenteditable="true"]')) return;
        onClearTaskSelection();
        if (selectedEdgeKeys.length > 0) onClearEdgeSelection();
      }}
      onDragOver={event => {
        if (!draggedTaskId) return;
        const day = dropDay(event);
        if (!day) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setActiveDropTargetKey(`gantt-date:${day.dateKey}`);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveDropTargetKey(null);
      }}
      onDrop={event => {
        const day = dropDay(event);
        if (!day || !draggedTaskId) return;
        event.preventDefault();
        onSetConfiguredDate(draggedTaskId, day.isoDate, day.dateKey);
      }}
    >
      {/* Left Task List Column (written-out task names stacked vertically) */}
      <div
        data-gantt-list
        style={{
          width: LEFT_LIST_WIDTH,
          height: layout.canvasHeight,
        }}
        className="sticky left-0 z-40 bg-white/95 border-r border-slate-300"
      >
        {/* Left List Header */}
        <div
          style={{ height: HEADER_HEIGHT }}
          className="w-full border-b border-slate-300/90 bg-slate-100 select-none sticky top-0 z-10"
        />

        {/* Left List Task Rows */}
        {layout.barList.map(({ task, rowIndex }) => {
          const role: HighlightRole = highlights[task.id] ?? null;
          const dropKey = `gantt-list-task:${task.id}`;
          const isDropTarget =
            activeDropTargetKey === dropKey && draggedTaskId !== task.id;
          const isBeingDragged = draggedTaskId === task.id;

          const appearance = taskAppearanceRole(task, role, isDropTarget, isAltDrag);

          let rowBgClasses = 'bg-white hover:bg-slate-50/90';
          if (appearance === 'drop') {
            rowBgClasses = 'bg-amber-50 ring-1 ring-inset ring-amber-400';
          } else if (appearance === 'selected') {
            rowBgClasses = 'bg-sky-100/85';
          } else if (appearance === 'predecessor') {
            rowBgClasses = 'bg-amber-100/75';
          } else if (appearance === 'successor') {
            rowBgClasses = 'bg-purple-100/75';
          } else if (appearance === 'active') {
            rowBgClasses = 'bg-emerald-50/90';
          }

          return (
            <div
              key={`left-row-${task.id}`}
              style={{
                top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                height: ROW_HEIGHT,
              }}
              {...taskInteractions(task.id, dropKey, props)}
              data-task-drag-disabled={titleEditor.taskId === task.id || undefined}
              className={`absolute left-0 right-0 px-2.5 border-b border-slate-200/60 flex items-center gap-1.5 cursor-pointer transition-colors ${rowBgClasses} ${
                isBeingDragged ? 'opacity-35' : ''
              } ${task.isDeemphasized && !role ? 'opacity-80' : ''}`}
            >
              <TaskDragHandle />
              <button
                type="button"
                aria-label={task.isActive ? t('Deaktivieren (Space)') : t('Aktivieren (Space)')}
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
            data-gantt-date={day.dateKey}
            style={{
              left: day.x,
              top: 0,
              width: day.width,
              height: layout.canvasHeight,
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
              className={`w-full border-b px-1.5 flex flex-col justify-center items-start select-none sticky top-0 z-30 ${
                isDropActive
                  ? 'border-sky-400 bg-sky-100'
                  : day.isWeekend
                  ? 'border-amber-300/90 bg-amber-100'
                  : day.isToday
                  ? 'border-indigo-300/90 bg-indigo-100'
                  : 'border-slate-300/90 bg-slate-100'
              }`}
              onClick={() => onClearTaskSelection()}
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
                  {formatDate(day.isoDate)}
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
          className="absolute border-b border-slate-200/55"
          onClick={() => onClearTaskSelection()}
        />
      ))}

      {/* SVG Layer for Non-Overlapping Vertical Lane Gantt Edges (Multi-Selectable with Ctrl/Shift & Deletable via Del/Backspace) */}
      <svg
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        className="absolute inset-0 pointer-events-none z-10"
      >
        <ArrowMarkers prefix="gantt-arrow" />

        {layout.routedEdges.map(({ from, to, edgeKey, pathD }) => {
          const fromRole = highlights[from];
          const toRole = highlights[to];
          const isPreview = deletionPreview.includes(edgeKey);
          const isEdgeSelected = !draggedTaskId && selectedEdgeKeys.includes(edgeKey);

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

          if (isPreview || isEdgeSelected) {
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
              data-edge-key={edgeKey}
              data-deletion-preview={isPreview || undefined}
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
                className="group-hover:stroke-[2.6px]"
              />
            </g>
          );
        })}
      </svg>

      {/* Compact Narrow Gantt Nodes (showing ONLY the Task ID) */}
      {/* Tasks outside the bounded calendar still contribute to the offscreen counters. */}
      {openTasks.filter(task => !layout.bars[task.id]).map(task => {
        const role = highlights[task.id];
        const effectiveKey = task.effectiveDateKey < toDateKey(now) ? toDateKey(now) : task.effectiveDateKey;
        return <span key={`offscreen-${task.id}`} hidden
          data-dependency-highlight={role?.startsWith('predecessor-') ? 'predecessor' : role?.startsWith('successor-') ? 'successor' : undefined}
          data-highlight-side={effectiveKey < toDateKey(now) ? 'before' : 'after'} />;
      })}
      {layout.barList.map(({ task, x, y, width, height }) => {
        const role: HighlightRole = highlights[task.id] ?? null;
        const dropKey = `gantt-task:${task.id}`;
        const isDropTarget =
          activeDropTargetKey === dropKey && draggedTaskId !== task.id;
        const isBeingDragged = draggedTaskId === task.id;
        const configuredDate = formatDate(task.configuredStart);

        const appearance = taskAppearanceRole(task, role, isDropTarget, isAltDrag);

        let containerClasses =
          'bg-white border-slate-300 text-slate-700 shadow-xs hover:border-slate-400';

        if (appearance === 'drop') {
          containerClasses = 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-400/30 shadow-md';
        } else if (appearance === 'selected') {
          containerClasses =
            'bg-sky-100 border-sky-500 text-sky-950 font-semibold ring-2 ring-sky-400/35 shadow-sm';
        } else if (appearance === 'predecessor') {
          containerClasses =
            'bg-amber-100 border-amber-500 text-amber-950 font-semibold ring-2 ring-amber-400/30 shadow-sm';
        } else if (appearance === 'successor') {
          containerClasses =
            'bg-purple-100 border-purple-500 text-purple-950 font-semibold ring-2 ring-purple-400/30 shadow-sm';
        } else if (appearance === 'active') {
          containerClasses =
            'bg-emerald-100 border-emerald-500 text-emerald-950 font-semibold ring-2 ring-emerald-500/25 shadow-sm';
        } else if (appearance === 'deemphasized') {
          containerClasses =
            'bg-white/80 border-slate-200/80 text-slate-600 opacity-80 hover:opacity-100';
        }

        return (
          <div
            key={task.id}
            data-gantt-node={task.id}
            data-drag-handle
            data-dependency-highlight={role?.startsWith('predecessor-') ? 'predecessor' : role?.startsWith('successor-') ? 'successor' : undefined}
            style={{
              left: x,
              top: y,
              width,
              height,
            }}
            title={t('{id}: {title} ({date}). Auf Datum ziehen: Startdatum setzen; auf Task ziehen: Vorgänger setzen; Alt: Kanten lösen.', { id: task.id, title: task.title, date: configuredDate })}
            {...taskInteractions(task.id, dropKey, props)}
            className={`absolute z-20 rounded-lg border px-1 flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors font-mono text-[11px] ${containerClasses} ${
              isBeingDragged ? 'opacity-35' : ''
            }`}
          >
            <span className="pointer-events-none select-none">{task.id}</span>
          </div>
        );
      })}
    </div>
  );
}
