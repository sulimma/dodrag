import { useEffect, useRef, useState } from 'react';
import type { EventCommand } from '../domain/eventSchema';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents, toDateKey } from '../domain/projector';
import { dayMarkers, formatMarkerTime, parseMarkerTime, clampMarkerMinute, proportionalMarkerMinute, type TimeMarker } from '../domain/timeMarkers';
import type { useDatabaseSnapshot } from './useDatabaseSnapshot';
import type { DragIdentity } from './useTaskDrag';
import type { PushToast } from './useToasts';
import { t } from '../i18n';

// Editing, day initialization and gestures all use the confirmed FIFO snapshot.
// No marker is a synthetic task. A new divider binds only the following suffix
// up to the next divider, in the same atomic undo group as its creation.
export function useTimeMarkers(
 database: ReturnType<typeof useDatabaseSnapshot>, state: ReturnType<typeof projectEvents>, now: Date,
 dragIdentity: React.MutableRefObject<DragIdentity | null>, clearTaskSelection: () => void,
 pushToast: PushToast, setMoved: (key: string) => void, refreshNow?: (now: Date) => void,
) {
 const [selectedMarkerId, select] = useState<string | null>(null);
 const [editingMarkerId, setEditing] = useState<string | null>(null);
 const [editingValue, setValue] = useState('');
 const editor = useRef<{ id: string; database: string; value: string; revision: number } | null>(null);
 const saving = useRef<Promise<void> | null>(null);
 const pendingDays = useRef(new Set<string>());
 const commit = async (build: (current: ReturnType<typeof projectEvents>) => EventCommand[]) => database.mutate(async () => {
   const commands = build(projectEvents(database.confirmedEvents.current, now));
   return commands.length ? eventBridge.appendBatch(commands) : database.confirmedEvents.current;
 });
 const dayKeys = state.listEntries.flatMap(entry => entry.kind === 'date' ? [entry.dateKey] : []);
 useEffect(() => {
   if (!database.snapshotReady || database.appSettings?.defaultTimeMarkers === undefined) return;
   const identity = database.databaseIdentity.current;
   const days = dayKeys.filter(day => !state.timeline.days.has(day) && !pendingDays.current.has(`${identity}:${day}`));
   if (!days.length) return;
   for (const day of days) pendingDays.current.add(`${identity}:${day}`);
   const minutes = [...(database.appSettings?.defaultTimeMarkers ?? [])];
   void commit(current => days.filter(day => !current.timeline.days.has(day)).map(dateKey => ({
     type: 'TIME_DAY_INITIALIZED', payload: { dateKey, minutes },
   }))).finally(() => { for (const day of days) pendingDays.current.delete(`${identity}:${day}`); });
 }, [database.snapshotReady, database.appSettings?.activeDatabasePath, dayKeys.join('|'), state.timeline, database.appSettings?.defaultTimeMarkers]);
 const cancelEdit = () => { editor.current = null; setEditing(null); refreshNow?.(new Date()); };
 const startEdit = (marker: TimeMarker) => {
   if (!database.snapshotConfirmed.current) return;
   clearTaskSelection(); select(marker.id);
   editor.current = { id: marker.id, database: database.databaseIdentity.current, value: formatMarkerTime(marker.minute), revision: 0 };
   setEditing(marker.id); setValue(formatMarkerTime(marker.minute));
 };
 const changeEdit = (value: string) => { if (editor.current) { editor.current.value = value; editor.current.revision++; } setValue(value); };
 const commitEdit = async () => {
   if (saving.current) { await saving.current; return; }
   const session = editor.current;
   if (!session || session.database !== database.databaseIdentity.current) return;
   const requested = parseMarkerTime(session.value);
   if (requested === null) { pushToast(t('Ungültige Uhrzeit'), 'warning'); cancelEdit(); return; }
   const revision = session.revision;
   const operation = (async () => {
     let corrected: number | null = null;
     const updated = await commit(current => {
       const marker = current.timeline.markers.get(session.id);
       if (!marker || marker.removed) return [];
       const markers = dayMarkers(current.timeline, marker.dateKey), index = markers.findIndex(item => item.id === marker.id);
       const minute = clampMarkerMinute(requested, markers[index - 1]?.minute, markers[index + 1]?.minute);
       if (minute !== requested) corrected = minute;
       return marker.minute === minute ? [] : [{ type: 'TIME_MARKER_SET', payload: { markerId: marker.id, minute } }];
     });
     if (updated && editor.current === session && session.revision === revision) {
       if (corrected !== null) pushToast(t('Uhrzeit auf {time} begrenzt: benachbarte Marker dürfen nicht überschritten werden.', { time: formatMarkerTime(corrected) }), 'warning');
       cancelEdit();
     }
   })();
   saving.current = operation;
   try { await operation; } finally { saving.current = null; }
 };
 const remove = async (id: string) => {
   const updated = await commit(current => current.timeline.markers.has(id) && !current.timeline.markers.get(id)!.removed
     ? [{ type: 'TIME_MARKER_REMOVED', payload: { markerId: id } }] : []);
   if (updated) { if (selectedMarkerId === id) select(null); if (editor.current?.id === id) cancelEdit(); }
 };
 const markerDrag = () => {
   const identity = dragIdentity.current;
   return identity?.database === database.databaseIdentity.current ? identity.marker : undefined;
 };
 const dropOnDate = (dateKey: string) => {
   const source = markerDrag();
   if (source?.markerId && source.dateKey === dateKey) void remove(source.markerId);
 };
 const createAtGap = (relativeTaskId: string, side: 'before' | 'after') => {
   if (!markerDrag()) return;
   const markerId = `marker-${crypto.randomUUID()}`;
   void commit(current => {
     const entries = current.listEntries;
     const index = entries.findIndex(entry => entry.kind === 'task' && entry.task.id === relativeTaskId);
     if (index < 0) return [];
     const task = current.tasks[relativeTaskId];
     if (task.isActive || task.completed) return [];
     const position = index + (side === 'after' ? 1 : 0);
     // Active tasks form their own leading block and never enter the ratio.
     let start = position, end = position;
     while (start > 0 && entries[start - 1].kind === 'task' && !(entries[start - 1] as Extract<typeof entries[number], { kind: 'task' }>).task.isActive) start--;
     while (end < entries.length && entries[end].kind === 'task' && !(entries[end] as Extract<typeof entries[number], { kind: 'task' }>).task.isActive) end++;
     const previous = entries[start - 1], next = entries[end];
     let lower = previous?.kind === 'time' ? previous.marker.minute : 480;
     let upper = next?.kind === 'time' ? next.marker.minute : 1200;
     // Existing markers outside the nominal day bounds still have chronological neighbors.
     if (previous?.kind !== 'time' && lower >= upper) lower = Math.max(0, upper - 60);
     if (next?.kind !== 'time' && upper <= lower) upper = Math.min(1440, lower + 60);
     const clock = now;
     if (task.effectiveDateKey === toDateKey(clock)) lower = Math.max(lower, clock.getHours() * 60 + clock.getMinutes() + 1);
     // After 20:00 the nominal upper bound must not prevent future proposals.
     if (next?.kind !== 'time' && upper <= lower) upper = Math.min(1440, lower + 60);
     const minute = proportionalMarkerMinute(lower, upper, position - start, end - start);
     if (minute === null) { pushToast(t('Kein Platz für einen weiteren Uhrzeitmarker'), 'warning'); return []; }
     const suffix = entries.slice(position, end).flatMap(entry => entry.kind === 'task' ? [entry.task.id] : []);
     setMoved(`time:${markerId}`);
     return [
       { type: 'TIME_MARKER_CREATED', payload: { markerId, dateKey: task.effectiveDateKey, minute } },
       ...suffix.map(taskId => ({ type: 'TASK_TIME_MARKER_SET' as const, payload: { taskId, markerId } })),
     ];
   });
 };
 const reset = () => { select(null); cancelEdit(); };
 return { selectedMarkerId, editingMarkerId, editingValue, select: (id: string | null) => { if (id) clearTaskSelection(); select(id); },
   startEdit, changeEdit, commitEdit, cancelEdit, remove, dropOnDate, createAtGap, reset, hasOpen: () => editor.current !== null };
}
