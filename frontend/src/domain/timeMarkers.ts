import { t } from '../i18n';
import type { StoredEvent } from './types';
import type { EventCommand } from './eventSchema';
import { localDate } from './dates';

export interface TimeMarker { id: string; dateKey: string; minute: number; removed?: boolean }
export interface TimelineState { days: Set<string>; markers: Map<string, TimeMarker>; bindings: Map<string, string> }

// Markers constrain earliest start, never configuredStart. A binding survives
// activation and marker expiration; deletion removes only its effective bound.
// Initialized days include empty/tombstoned days so hiding and reappearing never
// reapplies changed defaults. Initialization is system bookkeeping, not undo.
export function projectTimeline(events: readonly StoredEvent[]): TimelineState {
  const state: TimelineState = { days: new Set(), markers: new Map(), bindings: new Map() };
  const taskIds = new Set<string>();
  for (const event of events) {
    if (event.undone) continue;
    if (event.type === 'TASK_CREATED') taskIds.add(event.payload.taskId);
    if (event.type === 'TASK_START_DATE_SET') state.bindings.delete(event.payload.taskId);
    applyTimelineCommand(state, event, taskIds);
  }
  return state;
}
export function applyTimelineCommand(state: TimelineState, command: EventCommand, tasks: ReadonlySet<string>): boolean {
  switch (command.type) {
    case 'TIME_DAY_INITIALIZED': {
      const { dateKey, minutes } = command.payload;
      if (state.days.has(dateKey)) return false;
      state.days.add(dateKey);
      for (const minute of minutes) {
        const id = `default-${dateKey}-${minute}`;
        if (state.markers.has(id)) throw new Error(t('Diese Uhrzeit ist bereits vorhanden'));
        state.markers.set(id, { id, dateKey, minute });
      }
      return true;
    }
    case 'TIME_MARKER_CREATED': {
      const { markerId: id, dateKey, minute } = command.payload;
      if (state.markers.has(id) || dayMarkers(state, dateKey).some(marker => marker.minute === minute)) throw new Error(t('Diese Uhrzeit ist bereits vorhanden'));
      state.markers.set(id, { id, dateKey, minute });
      return true;
    }
    case 'TIME_MARKER_SET': {
      const marker = state.markers.get(command.payload.markerId);
      if (!marker || marker.removed) throw new Error(t('Uhrzeitmarker nicht verfügbar'));
      const markers = dayMarkers(state, marker.dateKey), index = markers.findIndex(item => item.id === marker.id);
      const minute = command.payload.minute;
      if (minute <= (markers[index - 1]?.minute ?? -1) || minute >= (markers[index + 1]?.minute ?? 1440)) throw new Error(t('Uhrzeitmarker dürfen sich nicht überholen'));
      if (marker.minute === minute) return false;
      state.markers.set(marker.id, { ...marker, minute });
      return true;
    }
    case 'TIME_MARKER_REMOVED': {
      const marker = state.markers.get(command.payload.markerId);
      if (!marker) throw new Error(t('Uhrzeitmarker nicht verfügbar'));
      if (marker.removed) return false;
      state.markers.set(marker.id, { ...marker, removed: true });
      return true;
    }
    case 'TASK_TIME_MARKER_SET': {
      const { taskId, markerId } = command.payload;
      if (!tasks.has(taskId)) throw new Error(t('Unknown task: {id}', { id: taskId }));
      if (markerId && (!state.markers.has(markerId) || state.markers.get(markerId)!.removed)) throw new Error(t('Uhrzeitmarker nicht verfügbar'));
      if ((state.bindings.get(taskId) ?? null) === markerId) return false;
      if (markerId) state.bindings.set(taskId, markerId); else state.bindings.delete(taskId);
      return true;
    }
  }
  return false;
}
export function dayMarkers(state: TimelineState, dateKey: string): TimeMarker[] {
  return [...state.markers.values()].filter(marker => !marker.removed && marker.dateKey === dateKey).sort((a, b) => a.minute - b.minute);
}
export function markerStart(marker: TimeMarker): string {
  const [year, month, day] = marker.dateKey.split('-').map(Number);
  return localDate(year, month, day, Math.floor(marker.minute / 60), marker.minute % 60).toISOString();
}
export function formatMarkerTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
export function parseMarkerTime(value: string): number | null {
  const match = /^(\d{1,2})(?::([0-5]\d))?$/.exec(value.trim());
  return match && Number(match[1]) < 24 ? Number(match[1]) * 60 + Number(match[2] ?? 0) : null;
}

// Calendar-day limits are validation limits, not artificial 08:00/20:00 markers.
// Only actual neighbors reserve 15 minutes. In a tighter interval use its middle.
export function clampMarkerMinute(requested: number, previous?: number, next?: number): number {
  const minimum = previous === undefined ? 0 : previous + 15;
  const maximum = next === undefined ? 1439 : next - 15;
  return minimum > maximum ? Math.floor(((previous ?? -1) + (next ?? 1440)) / 2)
    : Math.max(minimum, Math.min(maximum, requested));
}
export function proportionalMarkerMinute(lower: number, upper: number, before: number, total: number): number | null {
  if (upper - lower < 2) return null;
  const proposed = lower + (upper - lower) * (total ? before / total : 0.5);
  const firstHour = (Math.floor(lower / 60) + 1) * 60;
  const lastHour = (Math.ceil(upper / 60) - 1) * 60;
  if (firstHour <= lastHour) return Math.max(firstHour, Math.min(lastHour, Math.round(proposed / 60) * 60));
  // Whole-hour rounding is impossible between these neighbors; a bounded minute
  // keeps the gesture useful without creating an equal-time or crossed marker.
  return clampMarkerMinute(Math.round(proposed), lower, upper);
}
