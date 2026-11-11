import { expect, it } from 'vitest';
import { projectEvents, projectTaskBalances, toDateKey } from './projector';
import { projectProtocol } from './protocol';
import { filterProtocolDays } from './search';
import { localDate } from './dates';
import type { EventCommand } from './eventSchema';
import type { StoredEvent } from './types';

it('keeps additions and removals separately, carries opening balances through empty days and revises undo history', () => {
 const first = localDate(2026, 11, 9, 12), today = localDate(2026, 11, 11, 12);
 const events: StoredEvent[] = [];
 const add = (command: EventCommand, at = today) => events.push({ ...command, id: `e${events.length}`, seq: events.length + 1, timestamp: at.toISOString(), undone: false });
 const create = (taskId: string, at: Date) => add({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: at.toISOString(), createdAt: at.toISOString() } }, at);
 for (let i = 0; i < 17; i++) create(`old${i}`, first);
 for (let i = 0; i < 6; i++) create(`new${i}`, today);
 for (let i = 0; i < 4; i++) add({ type: 'TASK_COMPLETED', payload: { taskId: `old${i}`, completedAt: today.toISOString() } });
 let balances = projectTaskBalances(events, ['2026-11-10']);
 expect(balances.get('2026-11-10')).toEqual({ start: 17, added: 0, removed: 0, end: 17 });
 expect(balances.get('2026-11-11')).toEqual({ start: 17, added: 6, removed: 4, end: 19 });
 add({ type: 'TASK_REOPENED', payload: { taskId: 'old0' } });
 expect(projectEvents(events, today).todayBalance).toEqual({ start: 17, added: 7, removed: 4, end: 20 });
 events[events.length - 1].undone = true;
 expect(projectEvents(events, today).todayBalance).toEqual({ start: 17, added: 6, removed: 4, end: 19 });
 const protocol = projectProtocol(events, projectEvents(events, today).tasks);
 const filtered = filterProtocolDays(protocol, new Set(['new0']));
 expect(filtered.find(day => day.dateKey === toDateKey(today))?.balance).toEqual({ start: 17, added: 6, removed: 4, end: 19 });
});
it('does not count redundant lifecycle commands or marker initialization as task changes', () => {
 const at = localDate(2026, 11, 11, 12).toISOString();
 const commands: EventCommand[] = [
   { type: 'TASK_CREATED', payload: { taskId: 'A', title: 'A', configuredStart: at, createdAt: at } },
   { type: 'TASK_REOPENED', payload: { taskId: 'A' } },
   { type: 'TASK_COMPLETED', payload: { taskId: 'A', completedAt: at } },
   { type: 'TASK_COMPLETED', payload: { taskId: 'A', completedAt: at } },
   { type: 'TIME_DAY_INITIALIZED', payload: { dateKey: '2026-11-11', minutes: [720] } },
 ];
 const events: StoredEvent[] = commands.map((command, index) => ({ ...command, seq: index + 1, id: `e${index}`, timestamp: at, undone: false }));
 expect(projectTaskBalances(events).get('2026-11-11')).toEqual({ start: 0, added: 1, removed: 1, end: 0 });
});
