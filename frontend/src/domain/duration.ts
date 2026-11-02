import type { TaskState } from './types';

export type DurationUnit = 'minutes' | 'hours' | 'days';
export const durationUnits: DurationUnit[] = ['minutes', 'hours', 'days'];
export const unitMinutes = { minutes: 1, hours: 60, days: 1440 };
export interface TaskTiming { duration: number; durationUnit: DurationUnit; progress: number | null }
export const legacyTiming: TaskTiming = { duration: 1, durationUnit: 'days', progress: null };
// Days retain local calendar semantics across DST. Hours and minutes are elapsed time.
export function addDuration(iso: string, amount: number, unit: DurationUnit): string {
  const date = new Date(iso);
  if (unit === 'days') {
    const whole = Math.trunc(amount);
    date.setDate(date.getDate() + whole);
    date.setTime(date.getTime() + (amount - whole) * 86400000);
  } else date.setTime(date.getTime() + amount * unitMinutes[unit] * 60000);
  return date.toISOString();
}
export function durationDays(task: TaskTiming): number { return task.duration * unitMinutes[task.durationUnit] / 1440; }
export function remainingDuration(task: TaskTiming): number { return Math.max(0, task.duration - (task.progress ?? 0)); }
export function progressRatio(task: Pick<TaskState, 'progress' | 'duration' | 'checklistProgress'>): number | null {
  if (task.progress !== null) return Math.min(1, Math.max(0, task.progress / task.duration));
  const list = task.checklistProgress;
  return list?.total ? list.checked / list.total : null;
}
export function validTiming(value: TaskTiming): boolean {
  return durationUnits.includes(value.durationUnit) && Number.isFinite(value.duration) && value.duration > 0 &&
    value.duration * unitMinutes[value.durationUnit] <= 52560000 &&
    (value.progress === null || Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= value.duration);
}
