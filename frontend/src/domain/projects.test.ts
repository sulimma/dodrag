import { expect, it } from 'vitest';
import { projectProgress } from './projects';

it('sums completed and planned days across duration units, with manual progress taking precedence', () => {
  const base = { durationUnit: 'days' as const, completed: false, checklistProgress: { checked: 1, total: 2 } };
  expect(projectProgress([
    { ...base, duration: 7, progress: 3 },
    { ...base, duration: 4, progress: null },
    { ...base, duration: 2, progress: 0 },
    { ...base, duration: 12, durationUnit: 'hours', completed: true, progress: 0 },
    { ...base, duration: 720, durationUnit: 'minutes', checklistProgress: null, progress: null },
  ])).toEqual({ done: 5.5, days: 14 });
  expect(projectProgress([])).toEqual({ done: 0, days: 0 });
});
