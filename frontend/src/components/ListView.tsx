import { ListTimeRow } from './ListTimeRow';
import { draggedTaskIdOf } from './taskInteractions';
import React, { useMemo, useRef } from 'react';
import { DateScrollOverlay } from './DateScrollOverlay';
import type { ListEntry } from '../domain/types';
import { SmoothFlipList } from './SmoothFlipList';
import { ListDateRow, ListTaskRow } from './ListRows';
import type { InlineEditor } from './inlineEditor';
import type { TaskViewInteractions } from './taskInteractions';
interface ListViewProps extends TaskViewInteractions {
  listEntries: ListEntry[];
  scrollRef?: React.RefObject<HTMLElement>;
  movedItemKey: string | null;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
}
// List and protocol use the same task/date rows, editors and drag handlers.
export function ListView(props: ListViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dateEntries = useMemo(() => new Map(props.listEntries.flatMap(entry => entry.kind === 'date' ? [[entry.dateKey, entry] as const] : [])), [props.listEntries]);
  const dateMarkers = useMemo(() => [...dateEntries.keys()].map(dateKey => ({ dateKey })), [dateEntries]);
  const listOrderedEdgeKeys = props.listEntries.flatMap(entry => entry.kind === 'task'
    ? entry.task.predecessorIds.map(id => `${id}->${entry.task.id}`) : []);
  const gap = (entry: Extract<ListEntry, { kind: 'task' }>, side: 'before' | 'after') => {
    const source = props.listEntries.find(item => item.kind === 'task' && item.task.id === props.draggedTaskId);
    const allowed = props.draggedMarker ? !entry.task.isActive : Boolean(props.draggedTaskId) &&
      (source?.kind !== 'task' || source.task.isActive === entry.task.isActive);
    const key = `insert:${entry.task.id}:${side}`;
    // Marker drags use each card's nearest edge, including the intervening gap.
    // The overlays exist above card bodies only during a marker gesture: normal
    // task drops still set dependencies, editors and selection remain reachable.
    const markerDrag = Boolean(props.draggedMarker);
    return <div data-task-insertion={key} data-task-drop-target={allowed ? key : undefined}
      data-insertion-active={props.activeDropTargetKey === key || undefined}
      style={markerDrag ? { height: 'calc(50% + 4px)', [side === 'before' ? 'top' : 'bottom']: -4 } : undefined}
      className={`absolute left-0 right-0 z-30 ${markerDrag ? '' : `h-3 ${side === 'before' ? '-top-2' : '-bottom-2'}`} ${allowed ? '' : 'pointer-events-none'}`}
      onDragOver={event => { if (!allowed) return; event.preventDefault(); event.stopPropagation(); props.setActiveDropTargetKey(key); }}
      onDragLeave={() => { if (props.activeDropTargetKey === key) props.setActiveDropTargetKey(null); }}
      onDrop={event => {
        if (!allowed) return;
        event.preventDefault(); event.stopPropagation();
        if (props.draggedMarker) props.timeline?.createAtGap(entry.task.id, side);
        else { const id = draggedTaskIdOf(event, props.draggedTaskId); if (id) props.onInsertTask?.(id, entry.task.id, side); }
      }}><div className={`absolute inset-x-0 ${markerDrag ? side === 'before' ? 'top-0' : 'bottom-0' : 'top-1/2'} border-t-2 ${props.activeDropTargetKey === key ? 'border-sky-500' : 'border-transparent'}`} /></div>;
  };
  return <div ref={contentRef}>
    <DateScrollOverlay scrollRef={props.scrollRef} contentRef={contentRef} dates={dateMarkers} height={44}
      renderDate={dateKey => <ListDateRow {...props} entry={dateEntries.get(dateKey)!} />} />
    <SmoothFlipList movedItemKey={props.movedItemKey} className="w-full space-y-2 pb-16">
    {props.listEntries.map((entry, index) => entry.kind === 'date'
      ? <ListDateRow key={entry.key} {...props} entry={entry} />
      : entry.kind === 'time' ? <ListTimeRow key={entry.key} {...props} entry={entry} />
      : <div key={entry.key} className="relative">
          <ListTaskRow {...props} entry={entry} listOrderedEdgeKeys={listOrderedEdgeKeys} />
          {gap(entry, 'before')}
          {(props.draggedMarker || props.listEntries[index + 1]?.kind !== 'task') && gap(entry, 'after')}
        </div>)}
  </SmoothFlipList></div>;
}
