// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MiniCornerView } from './MiniCornerView';
import { projectEvents } from '../domain/projector';

it('shows compact hover/focus actions, targets the task and never restores for an action', () => {
  const now = new Date(2026, 9, 20, 12);
  const task = projectEvents([{
    seq: 1, id: 'e1', timestamp: now.toISOString(), undone: false,
    type: 'TASK_CREATED', payload: { taskId: 'A', title: 'Task A',
      configuredStart: now.toISOString(), createdAt: now.toISOString() },
  }], now).tasks.A;
  const restore = vi.fn(), toggle = vi.fn(), resubmit = vi.fn(), complete = vi.fn();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const render = () => act(() => root.render(<MiniCornerView tasks={[task]}
    onSelectAndRestore={restore} onRestoreWindow={restore}
    onToggleActive={toggle} onResubmitTasks={resubmit} onCompleteTask={complete} />));
  const click = (button: Element) => act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  try {
    render();
    const actions = element.querySelector('.group-hover\\:visible')!;
    expect(actions.classList.contains('invisible')).toBe(true);
    expect(actions.classList.contains('group-focus-within:visible')).toBe(true);
    const buttons = actions.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    click(buttons[0]); click(buttons[1]); click(buttons[2]);
    expect(toggle).toHaveBeenCalledWith(task);
    expect(resubmit).toHaveBeenCalledWith('A', 'plus_1d');
    expect(complete).toHaveBeenCalledWith('A');
    expect(restore).not.toHaveBeenCalled();
    task.isActive = true;
    render();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-label')).toBe('Deaktivieren');
    const title = element.querySelector('[title="Task A"]')!;
    act(() => title.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(element.querySelector('.fixed')).toBeNull();
    click(title);
    expect(restore).toHaveBeenCalledWith('A');
  } finally {
    act(() => root.unmount()); element.remove(); vi.unstubAllGlobals();
  }
});
