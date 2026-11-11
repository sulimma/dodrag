import { clampMarkerMinute, proportionalMarkerMinute } from './timeMarkers';
import { expect, it } from 'vitest';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';
import { projectEvents } from './projector';
import { localDate } from './dates';
import { filterListEntries } from './search';
const iso = (hour: number) => localDate(2026, 11, 12, hour).toISOString();
function fixture() {
 const events: StoredEvent[] = [];
 const add = (command: EventCommand) => events.push({ ...command, seq: events.length + 1, id: `ev-${events.length}`, timestamp: iso(6), undone: false });
 for (const taskId of ['A', 'B']) add({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: iso(9), createdAt: iso(6) } });
 add({ type: 'TASK_TIMING_SET', payload: { taskId: 'A', duration: 1, durationUnit: 'hours', progress: null } });
 add({ type: 'DEPENDENCY_ADDED', payload: { taskId: 'B', predecessorId: 'A' } });
 return { events, add, view: (hour = 7) => projectEvents(events, localDate(2026, 11, 12, hour)) };
}
it('moves calculated start and real successors without rewriting configured starts; deletion and undo restore the constraint', () => {
 const { events, add, view } = fixture();
 add({ type: 'TIME_MARKER_CREATED', payload: { markerId: 'noon', dateKey: '2026-11-12', minute: 720 } });
 add({ type: 'TASK_TIME_MARKER_SET', payload: { taskId: 'A', markerId: 'noon' } });
 expect(view().tasks.A.configuredStart).toBe(iso(9));
 expect(view().tasks.A.calculatedStart).toBe(iso(12));
 expect(view().tasks.B.calculatedStart).toBe(iso(13));
 expect(view().tasks.B.configuredStart).toBe(iso(9));
 add({ type: 'TIME_MARKER_SET', payload: { markerId: 'noon', minute: 840 } });
 expect(view().tasks.A.calculatedStart).toBe(iso(14));
 expect(view().tasks.B.calculatedStart).toBe(iso(15));
 add({ type: 'TASK_ACTIVE_SET', payload: { taskId: 'A', isActive: true } });
 expect(view().tasks.A.effectiveStart).toBe(iso(7));
 add({ type: 'TASK_ACTIVE_SET', payload: { taskId: 'A', isActive: false } });
 expect(view().tasks.A.effectiveStart).toBe(iso(14));
 add({ type: 'TIME_MARKER_REMOVED', payload: { markerId: 'noon' } });
 expect(view().tasks.A.effectiveStart).toBe(iso(9));
 expect(view().tasks.B.effectiveStart).toBe(iso(10));
 events[events.length - 1].undone = true;
 expect(view().tasks.A.effectiveStart).toBe(iso(14));
 expect(view().tasks.A.allPredecessorIds).toEqual([]);
});
it('retains empty and edited day instances and hides reached markers without releasing their lower bound', () => {
 const { events, add, view } = fixture();
 add({ type: 'TIME_DAY_INITIALIZED', payload: { dateKey: '2026-11-12', minutes: [720, 900] } });
 const count = view().activeEventCount;
 expect(count).toBe(events.length - 1);
 expect(view().listEntries.filter(entry => entry.kind === 'time')).toHaveLength(2);
 add({ type: 'TIME_MARKER_SET', payload: { markerId: 'default-2026-11-12-720', minute: 780 } });
 add({ type: 'TIME_MARKER_REMOVED', payload: { markerId: 'default-2026-11-12-900' } });
 add({ type: 'TIME_DAY_INITIALIZED', payload: { dateKey: '2026-11-12', minutes: [600, 1000] } });
 expect(view().listEntries.filter(entry => entry.kind === 'time').map(entry => entry.marker.minute)).toEqual([780]);
 expect(filterListEntries(view().listEntries, new Set())).toEqual([]);
 expect(filterListEntries(view().listEntries, new Set(['A'])).filter(entry => entry.kind === 'time')).toHaveLength(1);
 add({ type: 'TASK_TIME_MARKER_SET', payload: { taskId: 'A', markerId: 'default-2026-11-12-720' } });
 expect(view(13).listEntries.some(entry => entry.kind === 'time')).toBe(false);
 expect(view(13).tasks.A.calculatedStart).toBe(iso(13));
 expect(projectEvents(JSON.parse(JSON.stringify(events)), localDate(2026, 11, 12, 7)).tasks.A.calculatedStart).toBe(iso(13));
 add({ type: 'TASK_START_DATE_SET', payload: { taskId: 'A', configuredStart: iso(10) } });
 expect(view().tasks.A.timeMarkerId).toBeUndefined();
 expect(view().tasks.A.effectiveStart).toBe(iso(10));
});

it('uses whole-hour proportional proposals where possible and keeps tight markers distinct', () => {
 expect(proportionalMarkerMinute(480, 1200, 1, 4)).toBe(660);
 expect(proportionalMarkerMinute(480, 720, 1, 100)).toBe(540);
 expect(proportionalMarkerMinute(660, 720, 1, 2)).toBe(690);
 expect(proportionalMarkerMinute(660, 661, 1, 2)).toBeNull();
 expect(clampMarkerMinute(1380)).toBe(1380);
 expect(clampMarkerMinute(0)).toBe(0);
 expect(clampMarkerMinute(360)).toBe(360);
 expect(clampMarkerMinute(900, 600, 720)).toBe(705);
 expect(clampMarkerMinute(100, 600, 720)).toBe(615);
 expect(clampMarkerMinute(900, 600, 620)).toBe(610);
});

it('takes an early slot clock time without changing the configured calendar date and restores the original time on deletion', () => {
 const { add, view } = fixture();
 add({ type: 'TIME_MARKER_CREATED', payload: { markerId: 'early', dateKey: '2026-11-12', minute: 360 } });
 add({ type: 'TASK_TIME_MARKER_SET', payload: { taskId: 'A', markerId: 'early' } });
 expect(view(5).tasks.A.configuredStart).toBe(iso(9));
 expect(view(5).tasks.A.effectiveStart).toBe(iso(6));
 add({ type: 'TIME_MARKER_REMOVED', payload: { markerId: 'early' } });
 expect(view(5).tasks.A.effectiveStart).toBe(iso(9));
});
