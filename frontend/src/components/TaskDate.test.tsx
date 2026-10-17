// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskDate } from './TaskDate';
import { TaskState } from '../domain/types';
import { localDate } from '../domain/dates';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('shares date editing, focus and isolated Enter/Escape/blur between compact and list displays', () => {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const task = { id: 'A', configuredStart: localDate(2026, 10, 19, 14, 30).toISOString() } as TaskState;
  const editor = { taskId: null as string | null, value: '2026-10-20 15:00', onStart: vi.fn(), onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() };
  const parentKey = vi.fn();
  for (const compact of [false, true]) {
    editor.taskId = null;
    act(() => root.render(<div onKeyDown={parentKey}><TaskDate task={task} editor={editor} compact={compact} /></div>));
    const button = element.querySelector('button')!;
    expect(button.textContent).toContain('2026-10-19');
    expect(button.textContent?.includes('14:30')).toBe(!compact);
    act(() => button.click()); expect(editor.onStart).toHaveBeenCalledWith(task);
    editor.taskId = 'A';
    act(() => root.render(<div onKeyDown={parentKey}><TaskDate task={task} editor={editor} compact={compact} /></div>));
    const input = element.querySelector('input')!;
    expect(document.activeElement).toBe(input); expect(input.value).toBe(editor.value);
    expect(input.selectionEnd).toBe(editor.value.length);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    act(() => input.blur());
  }
  expect(editor.onCommit).toHaveBeenCalledTimes(4); expect(editor.onCancel).toHaveBeenCalledTimes(2);
  expect(parentKey).not.toHaveBeenCalled();
  act(() => root.unmount()); element.remove();
});
