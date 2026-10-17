import { expect, it } from 'vitest';
import { futureLimit, localDate, normalizeUserDate } from './dates';
import { stableTopology } from './topology';
import { formatIso8601Display } from './projector';
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
