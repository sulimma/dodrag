import React, { useLayoutEffect, useRef } from 'react';
import type { ListEntry } from '../domain/types';
import { formatMarkerTime } from '../domain/timeMarkers';
import { formatDateHeading } from '../domain/projector';
import { DateLayerLine } from './DateLayerLine';
import { draggedTaskIdOf, type TaskViewInteractions } from './taskInteractions';
import { t } from '../i18n';

export function ListTimeRow(props: TaskViewInteractions & { entry: Extract<ListEntry, { kind: 'time' }> }) {
 const { entry, timeline } = props;
 const { marker } = entry;
 const meta = formatDateHeading(marker.dateKey, new Date());
 const editing = timeline?.editingMarkerId === marker.id;
 const row = useRef<HTMLDivElement>(null);
 const restoreFocus = useRef(false);
 const selected = timeline?.selectedMarkerId === marker.id;
 // Enter/Escape remove the focused input. Return focus to the still-selected
 // marker after rendering, but never steal focus from a later click/Tab target
 // while an asynchronous save is pending. Failed saves retain the input focus.
 useLayoutEffect(() => {
   if (editing || !restoreFocus.current) return;
   restoreFocus.current = false;
   if (selected && (document.activeElement === document.body || row.current?.contains(document.activeElement))) {
     row.current?.focus({ preventScroll: true });
   }
 }, [editing, selected]);
 return <DateLayerLine elementRef={row} dateKey={marker.dateKey} weekdayShort={entry.weekdayShort} isWeekend={meta.isWeekend} isToday={meta.isToday}
   dataFlipKey={entry.key} className="pt-3 pb-1" isDropActive={props.activeDropTargetKey === entry.key}
   selected={selected} editing={editing}
   draggableKey={`marker:${marker.id}`} onDragStart={event => props.onDragStartMarker?.(event, { dateKey: marker.dateKey, markerId: marker.id })}
   onClick={event => { event.stopPropagation(); timeline?.select(marker.id); if (!editing) event.currentTarget.focus(); }}
   onDoubleClick={event => { event.stopPropagation(); timeline?.startEdit(marker); }}
   onKeyDown={event => {
     if (editing) return;
     if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); void timeline?.remove(marker.id); }
     if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); timeline?.startEdit(marker); }
     if (event.key === 'Escape') { event.preventDefault(); timeline?.select(null); }
   }}
   time={editing ? <input autoFocus aria-label={t('Uhrzeitmarker')} value={timeline!.editingValue}
     className="w-16 rounded border border-sky-400 bg-white px-1 outline-none" onFocus={event => event.currentTarget.select()}
     onChange={event => timeline!.changeEdit(event.target.value)} onBlur={() => void timeline!.commitEdit()}
     onKeyDown={event => {
       event.stopPropagation();
       if (event.key === 'Enter') { event.preventDefault(); restoreFocus.current = true; void timeline!.commitEdit(); }
       if (event.key === 'Escape') { event.preventDefault(); restoreFocus.current = true; timeline!.cancelEdit(); }
     }} /> : <span title={t('Doppelklick zum Bearbeiten; Entf zum Löschen')}>{formatMarkerTime(marker.minute)}</span>}
   onDragOver={event => { if (!props.draggedTaskId) return; event.preventDefault(); event.stopPropagation(); props.setActiveDropTargetKey(entry.key); }}
   onDragLeave={() => { if (props.activeDropTargetKey === entry.key) props.setActiveDropTargetKey(null); }}
   onDrop={event => { event.preventDefault(); event.stopPropagation(); const id = draggedTaskIdOf(event, props.draggedTaskId); if (id) timeline?.bindTask(id, marker.id); }} />;
}
