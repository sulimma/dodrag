import * as v from 'valibot';
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

// Only the browser legacy loader may convert validated RFC3339 offsets. Keep the
// fractional digits verbatim: Date serialization would truncate nanoseconds.
export function normalizeLegacyTimestamp(input: unknown): string {
  const value = v.parse(timestamp, input);
  if (value.endsWith('Z')) return value;
  const fraction = /\.\d+/.exec(value)?.[0] ?? '';
  const instant = new Date(Date.parse(value.replace(/\.\d+/, '')));
  const year = instant.getUTCFullYear();
  const utc = `${String(year).padStart(4, '0')}-${String(instant.getUTCMonth() + 1).padStart(2, '0')}-${String(instant.getUTCDate()).padStart(2, '0')}T${String(instant.getUTCHours()).padStart(2, '0')}:${String(instant.getUTCMinutes()).padStart(2, '0')}:${String(instant.getUTCSeconds()).padStart(2, '0')}${fraction}Z`;
  return v.parse(utcTimestamp, utc);
}
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
export const CommandSchema = v.variant('type', [
  v.object({ type: v.literal('TASK_CREATED'), payload: v.strictObject({ taskId: id, title, configuredStart: timestamp, createdAt: utcTimestamp }) }),
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
