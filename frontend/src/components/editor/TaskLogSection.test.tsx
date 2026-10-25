// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskLogSection, type TaskLogSectionHandle } from '../TaskLogSection';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('uses ISO timestamps, shared link/image targets, file insertion, Enter and Shift+Enter', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const ref = createRef<TaskLogSectionHandle>(); const onAdd = vi.fn(async () => {}); const onContextMenu = vi.fn();
  await act(async () => root.render(<TaskLogSection ref={ref} taskId="t1" entries={[
    { id: 'e1', createdAt: '2026-10-25T12:30:00Z', text: 'https://example.org "C:\\a b.svg"' },
  ]} onAdd={onAdd} onRemove={vi.fn()} onContextMenu={onContextMenu} onError={vi.fn()} />));
  expect(element.querySelector('time')!.textContent).toMatch(/^2026-10-25 \d\d:\d\d$/);
  expect(element.querySelectorAll('[data-target-kind]')).toHaveLength(2);
  expect(element.querySelector('img')!.getAttribute('src')).toContain('/dodrag-media?taskId=t1');
  act(() => element.querySelector('img')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(onContextMenu.mock.lastCall![1].target.value).toBe('C:\\a b.svg');
  act(() => ref.current!.insertFiles(['C:\\a b.txt']));
  const field = element.querySelector('textarea')!;
  expect(field.value).toBe('"C:\\a b.txt"');
  act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
  expect(onAdd).not.toHaveBeenCalled();
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onAdd).toHaveBeenCalledWith('"C:\\a b.txt"'); expect(field.value).toBe('');
  act(() => root.unmount()); element.remove();
});

it('preserves a failed log draft and resets drafts when task changes', async () => {
  const element = document.createElement('div'); const root = createRoot(element);
  const ref = createRef<TaskLogSectionHandle>(); const onError = vi.fn();
  const render = (taskId: string) => <TaskLogSection ref={ref} taskId={taskId} entries={[]}
    onAdd={async () => { throw new Error('offline'); }} onRemove={vi.fn()} onContextMenu={vi.fn()} onError={onError} />;
  await act(async () => root.render(render('t1')));
  act(() => ref.current!.insertFiles(['C:\\draft.txt']));
  await act(async () => element.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onError).toHaveBeenCalledOnce(); expect(element.querySelector('textarea')!.value).toContain('draft.txt');
  await act(async () => root.render(render('t2')));
  expect(element.querySelector('textarea')!.value).toBe('');
  act(() => root.unmount()); element.remove();
});
