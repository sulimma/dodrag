import { describe, expect, it } from 'vitest';
import { applyCommand, copyReplayTasks, replayCommands } from './commands';
import { MAX_DESCRIPTION_BYTES, parseCommand } from './eventSchema';
import type { EventCommand } from './eventSchema';
import { computeChecklistProgress, projectEvents } from './projector';
import type { StoredEvent } from './types';

const iso = '2026-10-17T09:00:00Z';
const create: EventCommand = { type: 'TASK_CREATED', payload: { taskId: 'a', title: 'A', createdAt: iso, configuredStart: iso } };
const stored = (commands: EventCommand[]): StoredEvent[] => commands.map((command, i) => ({
  ...command, seq: i + 1, id: `e${i}`, timestamp: iso, undone: false,
}));

describe('task details validation and replay', () => {
  it.each([
    ['', true], ['a'.repeat(MAX_DESCRIPTION_BYTES), true], ['a'.repeat(MAX_DESCRIPTION_BYTES + 1), false],
    ['\u00e9'.repeat(MAX_DESCRIPTION_BYTES / 2), true], ['\u00e9'.repeat(MAX_DESCRIPTION_BYTES / 2) + 'a', false],
    ['\u{10000}'.repeat(MAX_DESCRIPTION_BYTES / 4), true], ['\ud800', false],
  ])('enforces description UTF-8 bytes (case %#)', (description, valid) => {
    const command = { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description } };
    if (valid) expect(() => parseCommand(command)).not.toThrow();
    else expect(() => parseCommand(command)).toThrow();
  });

  it('validates log IDs, nonblank text and RFC3339 timestamps without rewriting stored text', () => {
    const payload = { taskId: 'a', entryId: 'note-1', text: ' note\n', createdAt: iso };
    expect(parseCommand({ type: 'TASK_LOG_ADDED', payload }).payload).toEqual(payload);
    for (const override of [
      { entryId: '' }, { entryId: 'constructor' }, { entryId: '__proto__' }, { entryId: 'space id' }, { entryId: 'a'.repeat(129) },
      { text: '' }, { text: ' \n\t' }, { createdAt: '2027-02-29T09:00:00Z' }, { createdAt: '2026-10-17T09:00:00' },
      { createdAt: '2026-10-17T09:00:00+24:00' }, { createdAt: '2026-10-17T09:00:00.1234567890Z' },
    ]) expect(() => parseCommand({ type: 'TASK_LOG_ADDED', payload: { ...payload, ...override } })).toThrow();
    expect(() => parseCommand({ type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: null } })).toThrow();
    expect(() => parseCommand({ type: 'TASK_LOG_ADDED', payload: { ...payload, extra: true } })).toThrow();
  });

  it('validates removal task/entry IDs and rejects missing or extra fields', () => {
    const payload = { taskId: 'a', entryId: 'note-1' };
    expect(parseCommand({ type: 'TASK_LOG_REMOVED', payload }).payload).toEqual(payload);
    for (const invalid of [
      { taskId: 'a' }, { ...payload, entryId: null }, { ...payload, entryId: '' },
      { ...payload, entryId: 'constructor' }, { ...payload, entryId: '__proto__' },
      { ...payload, entryId: 'space id' }, { ...payload, entryId: 'a'.repeat(129) },
      { ...payload, taskId: 'missing task' }, { ...payload, text: 'extra' },
    ]) expect(() => parseCommand({ type: 'TASK_LOG_REMOVED', payload: invalid })).toThrow();
  });

  it('removes only the requested entry, replays undo/redo with stable order, and no-ops if absent', () => {
    const first: EventCommand = { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'first', text: 'first', createdAt: iso } };
    const second: EventCommand = { type: 'TASK_LOG_ADDED', payload: { taskId: 'a', entryId: 'second', text: 'second', createdAt: iso } };
    const initial = stored([create,
      { ...create, payload: { ...create.payload, taskId: 'b' } },
      first, second, { ...first, payload: { ...first.payload, taskId: 'b' } },
      { type: 'TASK_COMPLETED', payload: { taskId: 'a', completedAt: iso } },
    ]);
    const remove: EventCommand = { type: 'TASK_LOG_REMOVED', payload: { taskId: 'a', entryId: 'first' } };
    const original = replayCommands(initial);
    const tasks = copyReplayTasks(original);
    expect(applyCommand(tasks, remove)).toBe(true);
    expect(applyCommand(tasks, remove)).toBe(false);
    expect(tasks.get('a')!.logEntries.map(entry => entry.id)).toEqual(['second']);
    expect(tasks.get('b')!.logEntries.map(entry => entry.id)).toEqual(['first']);
    expect(tasks.get('a')!.completed).toBe(true);
    expect(original.tasks.get('a')!.logEntries.map(entry => entry.id)).toEqual(['first', 'second']);
    expect(() => applyCommand(tasks, { ...remove, payload: { ...remove.payload, taskId: 'missing' } })).toThrow();
    const events = [...initial, { ...remove, seq: 7, id: 'remove', timestamp: iso, undone: false }];
    const undone = events.map(event => event.id === 'remove' ? { ...event, undone: true } : event);
    expect(projectEvents(events, new Date(iso)).tasks.a.logEntries.map(entry => entry.id)).toEqual(['second']);
    expect(projectEvents(undone, new Date(iso)).tasks.a.logEntries).toEqual(original.tasks.get('a')!.logEntries);
    expect(replayCommands(undone).canRedo).toBe(true);
    const redone = undone.map(event => ({ ...event, undone: false }));
    expect(projectEvents(redone, new Date(iso)).tasks.a.logEntries.map(entry => entry.id)).toEqual(['second']);
    expect(applyCommand(tasks, { ...remove, payload: { taskId: 'a', entryId: 'second' } })).toBe(true);
    expect(tasks.get('a')!.logEntries).toEqual([]);
  });

  it('defaults legacy tasks and applies description changes/no-ops/clearing and derived progress', () => {
    const initial = stored([create]);
    expect(projectEvents(initial, new Date(iso)).tasks.a).toMatchObject({ description: '', logEntries: [], checklistProgress: null });
    const tasks = copyReplayTasks(replayCommands(initial));
    const command: EventCommand = { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '- [x] done\n- [ ] open' } };
    expect(applyCommand(tasks, command)).toBe(true);
    expect(applyCommand(tasks, command)).toBe(false);
    const events = stored([create, command]);
    expect(projectEvents(events, new Date(iso)).tasks.a.checklistProgress).toEqual({ checked: 1, total: 2 });
    expect(projectEvents(events.map(event => event.seq === 2 ? { ...event, undone: true } : event), new Date(iso)).tasks.a.description).toBe('');
    expect(projectEvents([...events, ...stored([{ type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'a', description: '' } }]).map(event => ({ ...event, seq: 3, id: 'clear' }))], new Date(iso)).tasks.a.checklistProgress).toBeNull();
    expect(() => applyCommand(tasks, { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'missing', description: '' } })).toThrow();
  });

  it('sorts logs by instant including offsets/nanoseconds and stable ties, and excludes undone additions', () => {
    const notes = [
      { entryId: 'late', text: ' late ', createdAt: '2026-10-17T10:00:00Z' },
      { entryId: 'nano2', text: 'second', createdAt: '2026-10-17T11:00:00.123456789+02:00' },
      { entryId: 'nano1', text: 'first', createdAt: '2026-10-17T09:00:00.123456788Z' },
      { entryId: 'tie', text: 'same instant', createdAt: '2026-10-17T09:00:00.123456789Z' },
    ];
    const commands: EventCommand[] = notes.map(note => ({ type: 'TASK_LOG_ADDED', payload: { taskId: 'a', ...note } }));
    const events = stored([create, ...commands]);
    const replay = replayCommands(events);
    expect(replay.tasks.get('a')!.logEntries.find(entry => entry.id === 'late')!.text).toBe('late');
    expect(projectEvents(events, new Date(iso)).tasks.a.logEntries.find(entry => entry.id === 'late')!.text).toBe('late');
    expect(replay.tasks.get('a')!.logEntries.map(entry => entry.id)).toEqual(['nano1', 'nano2', 'tie', 'late']);
    const undone = events.map(event => event.seq === 5 ? { ...event, undone: true } : event);
    expect(projectEvents(undone, new Date(iso)).tasks.a.logEntries.map(entry => entry.id)).toEqual(['nano1', 'nano2', 'late']);
    expect(projectEvents(events, new Date(iso)).tasks.a.logEntries).toHaveLength(4);
    const copy = copyReplayTasks(replay);
    expect(() => applyCommand(copy, commands[0])).toThrow();
    copy.get('a')!.logEntries[0].text = 'mutated copy';
    expect(replay.tasks.get('a')!.logEntries[0].text).toBe('first');
    const projection = projectEvents(events, new Date(iso));
    projection.tasks.a.logEntries[0].text = 'mutated projection';
    expect(projectEvents(events, new Date(iso)).tasks.a.logEntries[0].text).toBe('first');
    expect(() => applyCommand(copy, { type: 'TASK_LOG_ADDED', payload: { ...notes[0], taskId: 'missing' } })).toThrow();
  });
});

describe('computeChecklistProgress', () => {
  it.each([
    ['', null], ['plain text\n- item\n- [ ]', null],
    ['- [ ] open', { checked: 0, total: 1 }],
    ['- [x] done\n\t* [X] nested\n  + [ ] open\n- [y] invalid', { checked: 2, total: 3 }],
    ['- [x] yes\r\n- [ ] no\r\n', { checked: 1, total: 2 }],
    ['```markdown\n- [x] example\n```\n- [ ] real', { checked: 0, total: 1 }],
    ['~~~markdown\n- [x] example\n~~~\n+ [X] real', { checked: 1, total: 1 }],
    ['````\n- [x] example\n```\n- [ ] still fenced\n`````\n- [x] real', { checked: 1, total: 1 }],
    ['~~~~\n- [x] example\n~~~\n- [ ] still fenced\n~~~~~\n- [ ] real', { checked: 0, total: 1 }],
    ['```\n~~~\n- [x] example\n```\n- [ ] real', { checked: 0, total: 1 }],
    ['~~~\n```\n- [x] example\n~~~\n- [ ] real', { checked: 0, total: 1 }],
    ['```\n```not-a-close\n- [x] example\n```\n- [ ] real', { checked: 0, total: 1 }],
    ['- [x] real\n~~~\n- [ ] unclosed', { checked: 1, total: 1 }],
    ['  ```\n- [x] example\n  ```\n- [ ] real', { checked: 0, total: 1 }],
    ['```invalid`info\n- [x] real', { checked: 1, total: 1 }],
  ])('counts only checklist items outside fences (case %#)', (markdown, expected) => {
    expect(computeChecklistProgress(markdown as string)).toEqual(expected);
  });
});
