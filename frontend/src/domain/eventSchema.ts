import * as v from 'valibot';

const id = v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), v.check(value => !['constructor', '__proto__', 'prototype', 'toString'].includes(value)));
const timestamp = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/), v.check(value => {
  const day = value.slice(0, 10);
  const [year, month, date] = day.split('-').map(Number);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, date);
  const [hour, minute, second] = value.slice(11,19).split(':').map(Number);
  const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
  return hour < 24 && minute < 60 && second < 60 && (!offset || Number(offset[1]) < 24 && Number(offset[2]) < 60) && Number.isFinite(Date.parse(value)) && probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === date;
}));
const title = v.pipe(v.string(), v.minLength(1), v.check(value => value.trim().length > 0));
export const CommandSchema = v.variant('type', [
  v.object({ type: v.literal('TASK_CREATED'), payload: v.strictObject({ taskId: id, title, configuredStart: timestamp, createdAt: timestamp }) }),
  v.object({ type: v.literal('TASK_RENAMED'), payload: v.strictObject({ taskId: id, title }) }),
  v.object({ type: v.literal('TASK_START_DATE_SET'), payload: v.strictObject({ taskId: id, configuredStart: timestamp }) }),
  v.object({ type: v.literal('DEPENDENCY_ADDED'), payload: v.strictObject({ taskId: id, predecessorId: id }) }),
  v.object({ type: v.literal('DEPENDENCY_REMOVED'), payload: v.strictObject({ taskId: id, predecessorId: id }) }),
  v.object({ type: v.literal('TASK_ACTIVE_SET'), payload: v.strictObject({ taskId: id, isActive: v.boolean() }) }),
  v.object({ type: v.literal('TASK_COMPLETED'), payload: v.strictObject({ taskId: id, completedAt: timestamp }) }),
  v.object({ type: v.literal('TASK_REOPENED'), payload: v.strictObject({ taskId: id }) }),
]);
export type EventCommand = v.InferOutput<typeof CommandSchema>;
export function parseCommand(input: unknown): EventCommand { return v.parse(CommandSchema, input); }
export function parseStoredEvent(input: unknown) {
  const metadata = v.parse(v.object({ seq: v.pipe(v.number(), v.integer(), v.minValue(1)), id, timestamp, undone: v.boolean(), groupId: v.optional(v.string()) }), input);
  const command = parseCommand(input);
  return { ...metadata, ...command };
}
