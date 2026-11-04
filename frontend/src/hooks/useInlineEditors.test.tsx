// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useInlineEditors } from './useInlineEditors';
import type { StoredEvent, TaskState } from '../domain/types';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents, toDateKey } from '../domain/projector';

it('opens an instant as a local date and leaves its timestamp untouched on confirmation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  const task = { id: 'A', configuredStart: new Date(2026, 11, 31, 14, 30, 12).toISOString() } as TaskState;
  const mutate = vi.fn();
  let editor!: ReturnType<typeof useInlineEditors>;
  function Harness() {
    editor = useInlineEditors({ snapshotConfirmed: { current: true }, databaseIdentity: { current: 'db' }, mutate },
      { A: task }, new Date(2026, 11, 31), vi.fn(), vi.fn());
    return null;
  }
  try {
    act(() => root.render(<Harness />));
    act(() => editor.dateEditor.onStart(task));
    expect(editor.dateEditor.value).toBe('2026-12-31');
    await act(async () => { await editor.dateEditor.onCommit(); });
    expect(mutate).not.toHaveBeenCalled();
    expect(editor.dateEditor.taskId).toBeNull();
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});


it('keeps an active task under today when its configured date is explicitly edited into the future', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const now = new Date(2026, 9, 19, 12);
  let events: StoredEvent[] = [
    { seq: 1, id: 'create', timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
      payload: { taskId: 'A', title: 'A', configuredStart: now.toISOString(), createdAt: now.toISOString() } },
    { seq: 2, id: 'active', timestamp: now.toISOString(), undone: false, type: 'TASK_ACTIVE_SET',
      payload: { taskId: 'A', isActive: true } },
  ];
  const append = vi.spyOn(eventBridge, 'appendEvent').mockImplementation(async (type, payload) => {
    events = [...events, { type, payload, seq: events.length + 1, id: 'edit', timestamp: now.toISOString(), undone: false } as StoredEvent];
    return events;
  });
  const root = createRoot(document.createElement('div'));
  let editor!: ReturnType<typeof useInlineEditors>;
  function Harness() {
    editor = useInlineEditors({ snapshotConfirmed: { current: true }, databaseIdentity: { current: 'db' }, mutate: operation => operation() },
      projectEvents(events, now).tasks, now, vi.fn(), vi.fn());
    return null;
  }
  try {
    act(() => root.render(<Harness />));
    act(() => editor.dateEditor.onStart(projectEvents(events, now).tasks.A));
    act(() => editor.dateEditor.onChange('2026-12-01'));
    await act(async () => { await editor.dateEditor.onCommit(); });
    expect(editor.dateEditor.taskId).toBeNull();
    expect(projectEvents(events, now).tasks.A).toMatchObject({
      isActive: true, configuredStart: new Date(2026, 11, 1, 9).toISOString(), effectiveDateKey: toDateKey(now),
    });
  } finally { act(() => root.unmount()); append.mockRestore(); vi.unstubAllGlobals(); }
});