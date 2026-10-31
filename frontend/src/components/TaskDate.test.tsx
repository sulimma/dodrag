// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskDate } from './TaskDate';
import type { TaskState } from '../domain/types';
import { localDate } from '../domain/dates';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function mount(compact: boolean) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), commit = vi.fn(), cancel = vi.fn(), parentKey = vi.fn();
  const task = { id: 'A', configuredStart: localDate(2026, 10, 19, 14, 30).toISOString() } as TaskState;
  function Harness() {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState('2026-10-19 14:30');
    return <div onKeyDown={parentKey}><TaskDate task={task} compact={compact} editor={{
      taskId: editing ? 'A' : null, value,
      onStart: () => setEditing(true), onChange: setValue,
      onCommit: () => { commit(value); setEditing(false); },
      onCancel: () => { cancel(); setEditing(false); },
    }} /></div>;
  }
  act(() => root.render(<Harness />));
  const button = host.querySelector('button')!;
  expect(button.textContent).toContain('2026-10-19');
  expect(button.textContent?.includes('14:30')).toBe(!compact);
  act(() => button.click());
  const input = host.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  expect(input.selectionEnd).toBe(input.value.length);
  return { host, input, commit, cancel, parentKey, close: () => { act(() => root.unmount()); host.remove(); } };
}

it.each([false, true])('commits the controlled date on Enter or blur (compact=%s)', compact => {
  for (const enter of [true, false]) {
    const fixture = mount(compact);
    try {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fixture.input, '2026-10-20 15:00');
        fixture.input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => {
        if (enter) fixture.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        else fixture.input.blur();
      });
      expect(fixture.commit).toHaveBeenCalledOnce(); expect(fixture.commit).toHaveBeenCalledWith('2026-10-20 15:00');
      expect(fixture.cancel).not.toHaveBeenCalled(); expect(fixture.host.querySelector('input')).toBeNull();
      expect(fixture.parentKey).not.toHaveBeenCalled();
    } finally { fixture.close(); }
  }
});

it.each([false, true])('discards on Escape without committing the following blur (compact=%s)', compact => {
  const fixture = mount(compact);
  try {
    act(() => {
      fixture.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.input.blur();
    });
    expect(fixture.cancel).toHaveBeenCalledOnce(); expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.host.querySelector('input')).toBeNull(); expect(fixture.parentKey).not.toHaveBeenCalled();
  } finally { fixture.close(); }
});

it.each([false, true])('keeps IME Enter in the editing session (compact=%s)', compact => {
  const fixture = mount(compact);
  try {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    act(() => fixture.input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.host.querySelector('input')).toBe(fixture.input);
  } finally { fixture.close(); }
});
