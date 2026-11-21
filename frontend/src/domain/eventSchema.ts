import * as v from 'valibot';
import { validTiming } from './duration';
import type { StoredEvent } from './types';

const id = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  v.check(value => !['constructor', '__proto__', 'prototype', 'toString'].includes(value))
);
const timestamp = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/),
  v.check(value => {
    const [year, month, date] = value.slice(0, 10).split('-').map(Number);
    const probe = new Date(0);
    probe.setUTCFullYear(year, month - 1, date);
    const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
    const offset = /[+-](\d{2}):(\d{2})$/.exec(value);
    return hour < 24 && minute < 60 && second < 60 &&
      (!offset || Number(offset[1]) < 24 && Number(offset[2]) < 60) &&
      Number.isFinite(Date.parse(value)) && probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 && probe.getUTCDate() === date;
  })
);
const utcTimestamp = v.pipe(timestamp, v.check(value => value.endsWith('Z')));

const title = v.pipe(v.string(), v.minLength(1), v.check(value => value.trim().length > 0));
export const MAX_DESCRIPTION_BYTES = 256 * 1024;
const description = v.pipe(v.string(), v.check(value => {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > MAX_DESCRIPTION_BYTES) return false;
  }
  return true;
}));
const minute = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1439));
const dateKey = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/), v.check(value => {
  const probe = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(probe.getTime()) && probe.toISOString().slice(0, 10) === value;
}));
export const CommandSchema = v.variant('type', [
  v.object({ type: v.literal('PROJECT_SAVED'), payload: v.strictObject({
    projectId: id, code: v.pipe(v.string(), v.regex(/^[A-Z0-9]{2,8}$/)), color: v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)),
    summary: description, description,
  }) }),
  v.object({ type: v.literal('PROJECT_NOTE_SET'), payload: v.strictObject({ projectId: id, entryId: id, text: description }) }),
  v.object({ type: v.literal('PROJECT_MEMBER_SET'), payload: v.strictObject({ projectId: id, taskId: id, assigned: v.boolean() }) }),
  v.object({ type: v.literal('TIME_DAY_INITIALIZED'), payload: v.strictObject({ dateKey, minutes: v.pipe(v.array(minute), v.maxLength(96), v.check(values => values.every((value, index) => index === 0 || value > values[index - 1]))) }) }),
  v.object({ type: v.literal('TIME_MARKER_CREATED'), payload: v.strictObject({ markerId: id, dateKey, minute }) }),
  v.object({ type: v.literal('TIME_MARKER_SET'), payload: v.strictObject({ markerId: id, minute }) }),
  v.object({ type: v.literal('TIME_MARKER_REMOVED'), payload: v.strictObject({ markerId: id }) }),
  v.object({ type: v.literal('TASK_TIME_MARKER_SET'), payload: v.strictObject({ taskId: id, markerId: v.nullable(id) }) }),
  v.object({ type: v.literal('TASK_REORDERED'), payload: v.strictObject({ taskId: id, relativeTaskId: id, side: v.picklist(['before', 'after']) }) }),
  v.object({ type: v.literal('TASK_CREATED'), payload: v.strictObject({ taskId: id, title, configuredStart: timestamp, createdAt: utcTimestamp, copiedFromId: v.optional(id) }) }),
  v.object({ type: v.literal('TASK_TIMING_SET'), payload: v.pipe(v.strictObject({ taskId: id, duration: v.number(), durationUnit: v.picklist(['minutes', 'hours', 'days']), progress: v.nullable(v.number()) }), v.check(value => validTiming(value))) }),
  v.object({ type: v.literal('TASK_RENAMED'), payload: v.strictObject({ taskId: id, title }) }),
  v.object({ type: v.literal('TASK_DESCRIPTION_SET'), payload: v.strictObject({ taskId: id, description }) }),
  v.object({ type: v.literal('TASK_LOG_ADDED'), payload: v.strictObject({ taskId: id, entryId: id, text: title, createdAt: utcTimestamp }) }),
  v.object({ type: v.literal('TASK_LOG_UPDATED'), payload: v.strictObject({ taskId: id, entryId: id, text: title }) }),
  v.object({ type: v.literal('TASK_LOG_REMOVED'), payload: v.strictObject({ taskId: id, entryId: id }) }),
  v.object({ type: v.literal('TASK_START_DATE_SET'), payload: v.strictObject({ taskId: id, configuredStart: timestamp }) }),
  v.object({ type: v.literal('DEPENDENCY_ADDED'), payload: v.strictObject({ taskId: id, predecessorId: id }) }),
  v.object({ type: v.literal('DEPENDENCY_REMOVED'), payload: v.strictObject({ taskId: id, predecessorId: id }) }),
  v.object({ type: v.literal('TASK_ACTIVE_SET'), payload: v.strictObject({ taskId: id, isActive: v.boolean() }) }),
  v.object({ type: v.literal('TASK_COMPLETED'), payload: v.strictObject({ taskId: id, completedAt: utcTimestamp }) }),
  v.object({ type: v.literal('TASK_REOPENED'), payload: v.strictObject({ taskId: id }) }),
]);
export type EventCommand = v.InferOutput<typeof CommandSchema>;
export function commandTaskId(command: EventCommand): string {
  return 'taskId' in command.payload ? command.payload.taskId : '';
}
export function isTimelineCommand(command: EventCommand): boolean {
  return command.type.startsWith('TIME_') || command.type === 'TASK_TIME_MARKER_SET';
}
export function parseCommand(input: unknown): EventCommand {
  return v.parse(CommandSchema, input);
}

export function parseStoredEvent(input: unknown): StoredEvent {
  const metadata = v.parse(v.object({
    seq: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    id,
    timestamp: utcTimestamp,
    undone: v.boolean(),
    groupId: v.optional(v.pipe(v.string(), v.check(value => [...value].length <= 256))),
  }), input);
  const envelope = v.parse(v.object({ type: v.string(), payload: v.unknown() }), input);
  const command = parseCommand({
    type: envelope.type,
    payload: typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload,
  });
  return { ...metadata, ...command };
}
