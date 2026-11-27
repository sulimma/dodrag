import { afterEach, expect, it } from 'vitest';
import { getLanguage, setLanguage } from '../../i18n';
import { formatTaskSummary } from './CopyTaskSummary';

const originalLanguage = getLanguage();
afterEach(() => setLanguage(originalLanguage));

it('copies only the four summary fields with a localized status and the unchanged ISO date', () => {
  const task = { id: '26-101', title: 'A <task>', date: '2026-11-26', description: 'private', logEntries: ['private'] };
  setLanguage('en');
  expect(formatTaskSummary({ ...task, status: 'open' })).toBe('26-101 · A <task>\nOpen\n2026-11-26');
  expect(formatTaskSummary({ ...task, status: 'done' })).toBe('26-101 · A <task>\nCompleted\n2026-11-26');
  setLanguage('de');
  expect(formatTaskSummary({ ...task, status: 'active' })).toBe('26-101 · A <task>\nAktiv\n2026-11-26');
});
