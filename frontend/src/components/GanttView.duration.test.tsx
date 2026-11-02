// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GanttView } from './GanttView';
import { ListView } from './ListView';
import { projectEvents } from '../domain/projector';
import type { EventCommand } from '../domain/eventSchema';
import type { TaskState } from '../domain/types';

it('sizes bars by duration, shows progress lines without changing rows, and enters progressed tasks from above at their remaining-work anchor', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const now = new Date('2026-11-02T09:00:00Z'), iso = now.toISOString();
  const commands: EventCommand[] = ['source', 'target', 'hours', 'plain'].map(taskId => ({ type: 'TASK_CREATED', payload: { taskId, title: taskId, configuredStart: iso, createdAt: iso } }));
  commands.push(
    { type: 'TASK_TIMING_SET', payload: { taskId: 'target', duration: 4, durationUnit: 'days', progress: 2 } },
    { type: 'TASK_TIMING_SET', payload: { taskId: 'hours', duration: 2, durationUnit: 'hours', progress: null } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'source', description: '- [x] done\n- [ ] open' } },
    { type: 'DEPENDENCY_ADDED', payload: { taskId: 'target', predecessorId: 'source' } },
  );
  const state = projectEvents(commands.map((command, i) => ({ ...command, seq: i + 1, id: `e${i}`, timestamp: iso, undone: false })), now);
  const noop = vi.fn();
  const props: React.ComponentProps<typeof GanttView> = {
    now, openTasks: state.openTasks, listEntries: state.listEntries,
    deletionPreview: [], selectedTaskId: null, selectedEdgeKeys: [], highlights: {}, draggedTaskId: null, isAltDrag: false, activeDropTargetKey: null,
    titleEditor: { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop },
    onSelectEdge: noop, onClearEdgeSelection: noop, onClearTaskSelection: noop, setActiveDropTargetKey: noop, onSelectTask: noop, onContextMenuTask: noop,
    onDragStartTask: noop, onAddPredecessor: noop, onRemoveDependencyBetween: noop, onSetConfiguredDate: noop, onToggleActive: noop,
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const node = (id: string) => host.querySelector<HTMLElement>(`[data-gantt-node="${id}"]`)!;
  const line = (id: string) => host.querySelector(`[data-gantt-list] [data-task-drag="${id}"] [role="progressbar"]`);
  try {
    act(() => root.render(<GanttView {...props} />));
    const dayWidth = parseFloat(host.querySelector<HTMLElement>('[data-gantt-date]')!.style.width);
    const channelWidth = dayWidth - parseFloat(node('source').style.width);
    expect(parseFloat(node('target').style.width)).toBe(dayWidth * 4 - channelWidth);
    expect(parseFloat(node('hours').style.width)).toBe(dayWidth - channelWidth);
    const anchorDay = host.querySelector<HTMLElement>('[data-gantt-date="2026-11-03"]')!;
    const firstDay = host.querySelector<HTMLElement>('[data-gantt-date="2026-11-02"]')!;
    const offset = parseFloat(node('source').style.left) - parseFloat(firstDay.style.left);
    const anchorX = parseFloat(anchorDay.style.left) + offset;
    expect(parseFloat(node('target').style.left)).toBe(anchorX - 2 * dayWidth);
    expect(parseFloat(node('target').style.left) + parseFloat(node('target').style.width)).toBe(anchorX + 2 * dayWidth - channelWidth);
    expect(host.querySelector('[data-gantt-date="2026-11-01"]')).not.toBeNull();
    const points = host.querySelector('[data-edge-key="source->target"] path')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [prevX, prevY, endX, endY] = points.slice(-4);
    expect(endX).toBe(parseFloat(node('target').style.left) + parseFloat(node('target').style.width) / 2); expect(prevX).toBe(endX); expect(prevY).toBeLessThan(endY);
    expect(endY).toBe(parseFloat(node('target').style.top) - 8);
    expect(points[2]).toBeGreaterThan(points[0]); // Exit the source to the right.
    expect(points[4]).toBe(points[2]); // Stay in that column channel.
    expect(points[2]).toBeGreaterThan(parseFloat(node('target').style.left)); // No detour around the target's left edge.
    expect(points.at(-6)).toBeLessThan(anchorX); // Last horizontal segment approaches from the left.
    expect(line('target')!.getAttribute('aria-valuenow')).toBe('50');
    expect(line('source')!.getAttribute('aria-valuenow')).toBe('50');
    expect(line('plain')).toBeNull();
    expect(Number((line('target') as HTMLElement).style.opacity)).toBe(Number((line('source') as HTMLElement).style.opacity));
    const targetRow = host.querySelector<HTMLElement>('[data-gantt-list] [data-task-drag="target"]')!;
    const rowHeight = targetRow.style.height;
    const edited: TaskState[] = props.openTasks.map(task => task.id === 'target' ? { ...task, progress: 3, duration: 5 } : task);
    act(() => root.render(<GanttView {...props} openTasks={edited} listEntries={props.listEntries.map(entry => entry.kind === 'task' ? { ...entry, task: edited.find(task => task.id === entry.task.id)! } : entry)} />));
    expect(line('target')!.getAttribute('aria-valuenow')).toBe('60');
    const editedPath = host.querySelector('[data-edge-key="source->target"] path')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(editedPath.at(-2)).toBeCloseTo(parseFloat(node('target').style.left) + parseFloat(node('target').style.width) * 0.6);

    expect(targetRow.style.height).toBe(rowHeight);
    act(() => root.render(<ListView {...props} dateEditor={props.titleEditor} movedItemKey={null} />));
    expect(host.querySelector('[data-task-drag="target"] [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(host.querySelector('[data-task-drag="plain"] [role="progressbar"]')).toBeNull();
    // Even subday progress before the Today anchor must remain visible, rather
    // than disappearing beneath the sticky task list.
    const subdayTasks = props.openTasks.map(task => ({ ...task, progress: task.id === 'hours' ? 1 : null }));
    act(() => root.render(<GanttView {...props} openTasks={subdayTasks} listEntries={props.listEntries.map(entry => entry.kind === 'task' ? { ...entry, task: subdayTasks.find(task => task.id === entry.task.id)! } : entry)} />));
    expect(host.querySelector('[data-gantt-date="2026-11-01"]')).not.toBeNull();
    const today = host.querySelector<HTMLElement>('[data-gantt-date="2026-11-02"]')!;
    expect(parseFloat(node('hours').style.left)).toBeCloseTo(parseFloat(today.style.left) + offset - dayWidth / 24);
    expect(parseFloat(node('hours').style.left)).toBeGreaterThan(248);
    const complete = props.openTasks.map(task => task.id === 'target' ? { ...task, progress: task.duration } : task);
    act(() => root.render(<GanttView {...props} openTasks={complete} listEntries={props.listEntries.map(entry => entry.kind === 'task' ? { ...entry, task: complete.find(task => task.id === entry.task.id)! } : entry)} />));
    const completePath = host.querySelector('[data-edge-key="source->target"] path')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(completePath.at(-2)).toBeLessThanOrEqual(parseFloat(node('target').style.left) + parseFloat(node('target').style.width));

  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
