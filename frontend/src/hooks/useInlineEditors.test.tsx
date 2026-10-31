// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useInlineEditors } from './useInlineEditors';
import type { TaskState } from '../domain/types';

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

