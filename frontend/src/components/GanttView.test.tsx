// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { GanttView } from './GanttView';
import { NetworkPlanView } from './NetworkPlanView';
import { localDate } from '../domain/dates';
import { formatIso8601Display } from '../domain/projector';
import { TaskState } from '../domain/types';

it('places incoming edges from further left lower, then orders equal-column sources by row', () => {
  const task = (id: string, day: number, predecessorIds: string[] = []): TaskState => ({
    id, title: id, creationOrder: 0,
    createdAt: '2026-10-17T12:00:00Z',
    configuredStart: localDate(2026, 10, day, 14, 30, 12).toISOString(),
    calculatedStart: null,
    effectiveStart: `2026-10-${day}T12:00:00Z`,
    effectiveDateKey: `2026-10-${day}`,
    predecessorIds, allPredecessorIds: predecessorIds, successorIds: [],
    isActive: false, completed: false, isDeemphasized: false,
  });
  const tasks = [
    task('left-upper', 17),
    task('near', 18),
    task('left-lower', 17),
    task('target', 19, ['left-upper', 'near', 'left-lower']),
    task('other', 19, ['left-upper']),
  ];
  const noop = vi.fn();
  const element = document.createElement('div');
  const props = {
    openTasks: tasks,
    listEntries: tasks.map(task => ({ kind: 'task' as const, key: task.id, task })),
    now: new Date(2026, 9, 17, 12),
    deletionPreview: [], selectedTaskId: null, selectedEdgeKeys: [], highlights: {},
    draggedTaskId: null, isAltDrag: false, activeDropTargetKey: null,
    titleEditor: { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop },
    dateEditor: { taskId: null, value: '', onChange: noop, onStart: noop, onCommit: noop, onCancel: noop },
    onSelectEdge: noop, onClearEdgeSelection: noop, onClearTaskSelection: noop, onAltKeyChange: noop,
    setActiveDropTargetKey: noop, setDraggedTaskId: noop, onSelectTask: noop,
    onContextMenuTask: noop, onDragStartTask: noop, onDragEndTask: noop,
    onAddPredecessor: noop, onRemoveDependencyBetween: noop,
    onSetConfiguredDate: noop, onToggleActive: noop,
  };
  element.innerHTML = renderToStaticMarkup(<GanttView {...props} />);
  const points = (key: string) => element.querySelector(`[data-edge-key="${key}"] path`)!
    .getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const upper = points('left-upper->target');
  const near = points('near->target');
  const lower = points('left-lower->target');
  const other = points('left-upper->other');
  const endY = (p: number[]) => p[p.length - 1];
  expect(endY(near)).toBeLessThan(endY(upper));
  expect(endY(upper)).toBeLessThan(endY(lower));
  // Existing outgoing Y order and vertical lane X order stay intact.
  expect(upper[1]).toBeLessThan(other[1]);
  expect(upper[4]).toBeGreaterThan(lower[4]);
  expect(lower[4]).toBeGreaterThan(other[4]);
  expect(element.querySelector('[data-gantt-node="target"]')!.getAttribute('title')).toContain('target: target (2026-10-19)');
  const networkMarkup = renderToStaticMarkup(<NetworkPlanView {...props} />);
  expect(networkMarkup).toContain('2026-10-19');
  element.innerHTML = networkMarkup;
  expect(element.textContent).not.toContain('14:30');
  expect(element.querySelector('button[aria-label="Startdatum target bearbeiten"]')).not.toBeNull();
  expect(formatIso8601Display(tasks[3].configuredStart).isoText).toBe('2026-10-19 14:30:12');
});
