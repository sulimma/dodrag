import { TaskBalance } from './TaskBalance';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ListEntry, TaskState } from '../domain/types';
import { dateKeyToIsoStart, toDateKey } from '../domain/projector';
import { protocolRows, protocolActionText, protocolTime, type ProtocolAction, type ProtocolDay } from '../domain/protocol';
import { ListDateRow, ListTaskRow } from './ListRows';
import { DateScrollOverlay } from './DateScrollOverlay';
import type { TaskViewInteractions } from './taskInteractions';
import { taskDropTargetInteractions } from './taskInteractions';
import type { InlineEditor } from './inlineEditor';
import { SourceIcon } from './editor/SourceIcon';
import { pathRoot } from './editor/targets';
import { openTarget, targetMenuItems } from './editor/contextMenu';
import { menuPosition, useContextMenu } from './ContextMenuPopup';
import { locale, t } from '../i18n';

// Separate header heights and compact single-line actions bound DOM size even for a
// single task with thousands of events. Full log text remains in title/details.
// Only headers drag tasks; action sources retain native copy-drag behavior.
const HEADER_HEIGHT = 56;
const DATE_HEIGHT = 40;
const ACTION_HEIGHT = 20;
// Prefix offsets let windowing and keyboard scrolling use the same geometry.
function rowAt(offsets: number[], position: number): number {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}
function protocolDateEntry(dateKey: string, now: Date): Extract<ListEntry, { kind: 'date' }> {
  const isoDate = dateKeyToIsoStart(dateKey), date = new Date(isoDate);
  return { kind: 'date', key: `date:${dateKey}`, dateKey, isoDate,
    weekdayShort: date.toLocaleDateString(locale, { weekday: 'short' }),
    isWeekend: [0, 6].includes(date.getDay()), isToday: dateKey === toDateKey(now),
    label: dateKey, subLabel: '', collapsedCount: 0 };
}
const OVERSCAN = 8;
interface ProtocolViewProps extends TaskViewInteractions {
  days: ProtocolDay[];
  tasks: Record<string, TaskState>;
  scrollRef: React.RefObject<HTMLElement>;
  initialScrollTop?: number;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
  now: Date;
  onOpenTask: (id: string) => void;
  onSelectTaskByKeyboard: (id: string) => void;
  onError: (error: unknown) => void;
  onNativeMenuChange: (open: boolean) => void;
  navigationRef: React.MutableRefObject<((direction: number) => void) | null>;
}

function ProtocolActionContent({ action, ...props }: Pick<ProtocolViewProps, 'onError' | 'onNativeMenuChange'> & { action: ProtocolAction }) {
  const showMenu = useContextMenu();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (action.kind === 'source') {
    const { target } = action;
    const root = target.kind === 'path' ? pathRoot(target.value) : '';
    const openMenu = async (event: React.MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      props.onNativeMenuChange(true);
      try {
        const items = targetMenuItems(target);
        const id = await showMenu(items, menuPosition(event));
        if (alive.current && items.some(item => item.id === id)) await openTarget(target, id);
      } catch (error) { props.onError(error); }
      finally { props.onNativeMenuChange(false); }
    };
    return <div className="flex items-center gap-1 min-w-0" data-context-menu-target onContextMenu={openMenu}>
      <SourceIcon target={target} />
      <button type="button" className="flex min-w-0 max-w-full text-sky-700 underline text-left" title={target.value}
        onClick={event => { event.stopPropagation(); void openTarget(target).catch(props.onError); }}>{root ? <>
          <span className="shrink-0">{root}</span>
          <span className="truncate min-w-0" style={{ direction: 'rtl', textAlign: 'left' }}><bdi dir="ltr">{target.value.slice(root.length)}</bdi></span>
        </> : <span className="truncate">{target.value}</span>}</button>
    </div>;
  }
  if (action.kind === 'renamed') return <span className="block truncate" title={action.oldTitle}>{protocolActionText(action)}</span>;
  if (action.kind === 'log') return <div className="truncate" title={action.text}>
    🟦 {action.text}
  </div>;
  return <span>{action.kind === 'completed' ? '🟥 ' : '🟩 '}{protocolActionText(action)}</span>;
}

export function ProtocolView(props: ProtocolViewProps) {
  const balances = useMemo(() => new Map(props.days.map(day => [day.dateKey, day.balance])), [props.days]);
  const balance = (dateKey: string) => { const value = balances.get(dateKey); return value ? <TaskBalance balance={value} opening /> : null; };
  const rows = useMemo(() => protocolRows(props.days), [props.days]);
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [occurrence, setOccurrence] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const following = useRef(true);
  const initialized = useRef(false);
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (row.kind === 'action' ? ACTION_HEIGHT : row.kind === 'date' ? DATE_HEIGHT : HEADER_HEIGHT));
    return result;
  }, [rows]);
  const dateIndices = useMemo(() => rows.flatMap((row, index) => row.kind === 'date' ? [index] : []), [rows]);
  const dateMarkers = useMemo(() => dateIndices.map(index => ({ dateKey: (rows[index] as Extract<typeof rows[number], { kind: 'date' }>).dateKey, offset: offsets[index] })), [dateIndices, offsets, rows]);
  const totalHeight = offsets[offsets.length - 1];
  const headerIndices = useMemo(() => rows.flatMap((row, index) => row.kind === 'task' ? [index] : []), [rows]);
  const orderedIds = useMemo(() => [...new Set(props.days.flatMap(day => day.entries.map(entry => entry.taskId)))], [props.days]);
  const edgeKeys = useMemo(() => orderedIds.flatMap(id => props.tasks[id].predecessorIds.map(pred => `${pred}->${id}`)), [orderedIds, props.tasks]);
  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);
  const lastHeaderByTask = useMemo(() => new Map(headerIndices.map(index => {
    const row = rows[index];
    return [row.kind === 'task' ? row.entry.taskId : '', row.key];
  })), [headerIndices, rows]);
  const chosen = occurrence === null ? undefined : rows[rowIndex.get(occurrence) ?? -1];
  const activeOccurrence = chosen?.kind === 'task' && chosen.entry.taskId === props.selectedTaskId ? occurrence
    : lastHeaderByTask.get(props.selectedTaskId ?? '');
  const offset = () => {
    const scroll = props.scrollRef.current;
    return scroll && root.current ? root.current.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop : 0;
  };
  useLayoutEffect(() => {
    const scroll = props.scrollRef.current;
    if (!scroll) return;
    const update = () => {
      following.current = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 24;
      setViewport({ top: Math.max(0, scroll.scrollTop - offset()), height: scroll.clientHeight || 600 });
    };
    scroll.addEventListener('scroll', update);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(scroll);
    update();
    return () => { scroll.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [props.scrollRef]);
  useLayoutEffect(() => {
    const scroll = props.scrollRef.current;
    if (!scroll) return;
    if (!initialized.current && props.initialScrollTop !== undefined) {
      scroll.scrollTop = Math.max(0, Math.min(props.initialScrollTop, offset() + totalHeight - scroll.clientHeight));
      initialized.current = true;
      following.current = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 24;
    } else if (!initialized.current || following.current) {
      scroll.scrollTop = Math.max(0, offset() + totalHeight - scroll.clientHeight);
      initialized.current = true;
      following.current = true;
    }
    setViewport({ top: Math.max(0, scroll.scrollTop - offset()), height: scroll.clientHeight || 600 });
  }, [totalHeight]);
  useEffect(() => { if (!props.draggedTaskId) setDragRow(null); }, [props.draggedTaskId]);
  useLayoutEffect(() => {
    props.navigationRef.current = direction => {
      if (!headerIndices.length) return;
      const current = headerIndices.findIndex(index => rows[index].key === activeOccurrence);
      const next = current < 0 ? (direction > 0 ? 0 : headerIndices.length - 1)
        : Math.max(0, Math.min(headerIndices.length - 1, current + direction));
      const index = headerIndices[next], row = rows[index];
      if (row.kind !== 'task') return;
      setOccurrence(row.key);
      props.onSelectTaskByKeyboard(row.entry.taskId);
      const scroll = props.scrollRef.current;
      if (scroll) {
        const top = offset() + offsets[index];
        if (top < scroll.scrollTop + DATE_HEIGHT) scroll.scrollTop = Math.max(0, top - DATE_HEIGHT);
        else if (top + HEADER_HEIGHT > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + HEADER_HEIGHT - scroll.clientHeight;
        setViewport({ top: Math.max(0, scroll.scrollTop - offset()), height: scroll.clientHeight || 600 });
      }
    };
    return () => { props.navigationRef.current = null; };
  });
  const first = Math.max(0, Math.min(rows.length, rowAt(offsets, viewport.top) - OVERSCAN));
  const end = Math.min(rows.length, rowAt(offsets, viewport.top + viewport.height) + 1 + OVERSCAN);
  const visible = new Set(Array.from({ length: Math.max(0, end - first) }, (_, i) => first + i));
  // Keep a drag origin/editor mounted while scrolling; repeated task occurrences
  // must never create competing autofocus inputs for the same shared editor.
  for (const key of [dragRow, props.titleEditor.taskId || props.dateEditor.taskId ? activeOccurrence : null]) {
    const index = key ? rowIndex.get(key) : undefined;
    if (index !== undefined) visible.add(index);
  }
  if (!rows.length) return <p className="px-6 py-5 text-sm text-slate-500">{t('Noch keine Ereignisse')}</p>;
  return <div ref={root} data-protocol-view className="relative w-full" style={{ height: totalHeight, overflowAnchor: 'none' }}>
    <DateScrollOverlay scrollRef={props.scrollRef} contentRef={root} dates={dateMarkers}
      height={DATE_HEIGHT} contentHeight={totalHeight} refreshKey={viewport.top}
      renderDate={dateKey => <ListDateRow {...props} entry={protocolDateEntry(dateKey, props.now)} trailing={balance(dateKey)} className="py-1" />} />
    {[...visible].sort((a, b) => a - b).map(index => {
      const row = rows[index];
      const shared = { ...props, orderedTaskIds: orderedIds };
      let content: React.ReactNode;
      if (row.kind === 'date') {
        const entry = protocolDateEntry(row.dateKey, props.now);
        content = <ListDateRow {...shared} entry={entry} trailing={balance(row.dateKey)} className="py-1" />;
      } else if (row.kind === 'task') {
        const editor = (value: InlineEditor): InlineEditor => ({ ...value,
          taskId: activeOccurrence === row.key ? value.taskId : null,
          onStart: task => { setOccurrence(row.key); value.onStart(task); },
        });
        content = <div onPointerDownCapture={() => setOccurrence(row.key)} onFocusCapture={() => setOccurrence(row.key)}
          onClickCapture={() => setOccurrence(row.key)} onContextMenuCapture={() => setOccurrence(row.key)}
          onDragStartCapture={() => setDragRow(row.key)}>
          <ListTaskRow {...shared} entry={{ kind: 'task', key: `task:${row.entry.taskId}`, task: props.tasks[row.entry.taskId] }}
            listOrderedEdgeKeys={edgeKeys} titleEditor={editor(props.titleEditor)} dateEditor={editor(props.dateEditor)} />
        </div>;
      } else {
        content = <div {...taskDropTargetInteractions(row.entry.taskId, `task:${row.entry.taskId}`, props)}
          onDoubleClick={event => { if (!(event.target as Element).closest('button,[data-source-drag]')) props.onOpenTask(row.entry.taskId); }}
          onClick={event => { event.stopPropagation(); setOccurrence(row.entry.key); if (!(event.target as Element).closest('button,[data-source-drag]')) props.onSelectTask(row.entry.taskId, event, orderedIds); }}
          className="h-full ml-6 pl-4 pr-3 border-l-2 border-slate-200 flex items-center gap-3 text-xs leading-5 text-slate-600">
          <time dateTime={row.action.timestamp} className="font-mono text-slate-400 shrink-0">{protocolTime(row.action.timestamp)}</time>
          <div className="min-w-0 flex-1"><ProtocolActionContent action={row.action} onError={props.onError} onNativeMenuChange={props.onNativeMenuChange} /></div>
        </div>;
      }
      // Move the existing gap below each action list without changing group
      // heights, date offsets or the virtual scroll extent.
      return <div key={row.key} data-protocol-row={row.kind} data-protocol-key={row.key}
        className="px-6"
        style={{ position: 'absolute', top: offsets[index],
          transform: row.kind === 'action' ? 'translateY(-10px)' : undefined,
          height: offsets[index + 1] - offsets[index], left: 0, right: 0 }}>{content}</div>;
    })}
  </div>;
}
