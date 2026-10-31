import React from 'react';
import type { ListEntry } from '../domain/types';
import { SmoothFlipList } from './SmoothFlipList';
import { ListDateRow, ListTaskRow } from './ListRows';
import type { InlineEditor } from './inlineEditor';
import type { TaskViewInteractions } from './taskInteractions';
interface ListViewProps extends TaskViewInteractions {
  listEntries: ListEntry[];
  movedItemKey: string | null;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
}
// List and protocol use the same task/date rows, editors and drag handlers.
export function ListView(props: ListViewProps) {
  const listOrderedEdgeKeys = props.listEntries.flatMap(entry => entry.kind === 'task'
    ? entry.task.predecessorIds.map(id => `${id}->${entry.task.id}`) : []);
  return <SmoothFlipList movedItemKey={props.movedItemKey} className="w-full space-y-2 pb-16">
    {props.listEntries.map(entry => entry.kind === 'date'
      ? <ListDateRow key={entry.key} {...props} entry={entry} />
      : <ListTaskRow key={entry.key} {...props} entry={entry} listOrderedEdgeKeys={listOrderedEdgeKeys} />)}
  </SmoothFlipList>;
}
