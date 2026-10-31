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
  return <div ref={contentRef}>
    <DateScrollOverlay scrollRef={props.scrollRef} contentRef={contentRef} dates={dateMarkers} height={44}
      renderDate={dateKey => <ListDateRow {...props} entry={dateEntries.get(dateKey)!} />} />
    <SmoothFlipList movedItemKey={props.movedItemKey} className="w-full space-y-2 pb-16">
    {props.listEntries.map(entry => entry.kind === 'date'
      ? <ListDateRow key={entry.key} {...props} entry={entry} />
      : <ListTaskRow key={entry.key} {...props} entry={entry} listOrderedEdgeKeys={listOrderedEdgeKeys} />)}
  </SmoothFlipList></div>;
}
