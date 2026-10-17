import { expect, it } from 'vitest';
import { futureLimit, localDate, normalizeUserDate } from './dates';
import { stableTopology } from './topology';
import { calculateQuickResubmitDate, formatIso8601Display, projectEvents, QuickResubmitTargetId, toDateKey } from './projector';
import { parseCommand } from './eventSchema';
const now = localDate(2026,10,17,12);
const key = (input: string) => { const d=new Date(normalizeUserDate(input,now)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
it('normalizes the exact comfort date contract', () => {
  expect(key('2027-10-35')).toBe('2027-11-01'); expect(key('2026-12')).toBe('2026-12-01');
  expect(key('11-05')).toBe('2026-11-05'); expect(key('10-05')).toBe('2027-10-05');
  expect(key('10-17')).toBe('2027-10-17'); expect(key('garbage')).toBe('2026-10-17');
  expect(key('2027-02-29')).toBe('2027-03-01'); expect(key('2028-02-29')).toBe('2028-02-29');
  expect(key('2037-10-17')).toBe('2037-10-17'); expect(key('2037-10-18')).toBe('2026-10-17');
  expect(key('2025-01-01')).toBe('2025-01-01'); expect(key('0099-01-01')).toBe('2026-10-17');
  expect(new Date(normalizeUserDate('2027-01-01 13:45:12',now)).getSeconds()).toBe(12);
  expect(futureLimit(localDate(2028,2,29)).getDate()).toBe(28);
  expect(formatIso8601Display(normalizeUserDate('2027-01-01 13:45:12',now)).isoText).toBe('2027-01-01 13:45:12');
  expect(() => parseCommand({type:'TASK_START_DATE_SET',payload:{taskId:'t1',configuredStart:'2027-01-01T24:00:00Z'}})).toThrow();
  const dst=new Date(normalizeUserDate('2027-03-28 02:30',now));
  expect([2,3]).toContain(dst.getHours());expect(dst.getMinutes()).toBe(30);
});
it('sorts deep graphs iteratively with deterministic disconnected nodes', () => {
  const nodes=Array.from({length:10000},(_,i)=>({id:`t${i}`,creationOrder:10000-i,predecessorIds:i?[`t${i-1}`]:[]}));
  expect(stableTopology(nodes).map(node=>node.id)).toEqual(nodes.map(node=>node.id));
  expect(stableTopology([{id:'b',creationOrder:1,predecessorIds:[]},{id:'a',creationOrder:1,predecessorIds:[]}]).map(node=>node.id)).toEqual(['a','b']);
});
it('resubmits from the displayed dependency-derived date, not the configured date or today', () => {
  const configuredStart = localDate(2026, 10, 17).toISOString();
  const state = projectEvents([
    { seq: 1, id: 'e1', timestamp: configuredStart, undone: false, type: 'TASK_CREATED', payload: { taskId: 'a', title: 'A', configuredStart: localDate(2026, 10, 25, 14, 30).toISOString() } },
    { seq: 2, id: 'e2', timestamp: configuredStart, undone: false, type: 'TASK_CREATED', payload: { taskId: 'b', title: 'B', configuredStart } },
    { seq: 3, id: 'e3', timestamp: configuredStart, undone: false, type: 'DEPENDENCY_ADDED', payload: { taskId: 'b', predecessorId: 'a' } },
  ], now);
  const task = state.tasks.b;
  expect(task.effectiveDateKey).toBe('2026-10-25');
  const expected: [QuickResubmitTargetId, string][] = [
    ['plus_2h', '2026-10-25 16:30'], ['plus_1d', '2026-10-26'],
    ['next_week', '2026-10-26'], ['plus_7d', '2026-11-01'], ['next_month', '2026-11-01'],
  ];
  for (const [target, date] of expected) {
    expect(formatIso8601Display(calculateQuickResubmitDate(target, task)).isoText).toBe(date);
  }
});
it('uses the visible Today group for overdue tasks and handles calendar boundaries', () => {
  const task = { effectiveStart: localDate(2026, 10, 1, 14, 30).toISOString(), effectiveDateKey: '2026-10-17' };
  expect(formatIso8601Display(calculateQuickResubmitDate('plus_2h', task)).isoText).toBe('2026-10-17 16:30');
  for (const [day, nextMonday] of [['2026-10-18', '2026-10-19'], ['2026-12-31', '2027-01-04']]) {
    expect(toDateKey(new Date(calculateQuickResubmitDate('next_week', { ...task, effectiveDateKey: day })))).toBe(nextMonday);
  }
  expect(toDateKey(new Date(calculateQuickResubmitDate('next_month', { ...task, effectiveDateKey: '2026-12-31' })))).toBe('2027-01-01');
  expect(formatIso8601Display(calculateQuickResubmitDate('plus_1d', { ...task, effectiveDateKey: '2027-03-27' })).isoText).toBe('2027-03-28');
});
