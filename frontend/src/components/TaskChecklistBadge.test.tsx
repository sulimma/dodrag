// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import { ListView } from './ListView';
import { NetworkPlanView } from './NetworkPlanView';
import { GanttView } from './GanttView';
import { MiniCornerView } from './MiniCornerView';
import { projectEvents } from '../domain/projector';
import { formatNumber, getLanguage, setLanguage, t } from '../i18n';

it('hides absent checklists and colors only fully checked lists green', () => {
  expect(renderToStaticMarkup(<TaskChecklistBadge progress={null} />)).toBe('');
  expect(renderToStaticMarkup(<TaskChecklistBadge progress={{ checked: 0, total: 0 }} />)).toBe('');
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<TaskChecklistBadge progress={{ checked: 3, total: 7 }} />);
  const badge = element.querySelector('[data-task-checklist-badge]')!;
  expect(badge.textContent).toBe('3/7');
  expect(badge.getAttribute('aria-label')).toBe(t('Checkliste: {checked} von {total} erledigt', { checked: '3', total: '7' }));
  expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(badge.classList.contains('text-emerald-700')).toBe(false);
  element.innerHTML = renderToStaticMarkup(<TaskChecklistBadge progress={{ checked: 7, total: 7 }} compact />);
  expect(element.firstElementChild?.textContent).toBe('7/7');
  expect(element.firstElementChild?.classList.contains('text-emerald-700')).toBe(true);
});

it('updates localized numbers and accessible text when the language changes', () => {
  const previous = getLanguage();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = document.createElement('div');
  const root = createRoot(element);
  try {
    act(() => setLanguage('de'));
    act(() => root.render(<TaskChecklistBadge progress={{ checked: 1234, total: 5678 }} />));
    const badge = element.firstElementChild!;
    expect(badge.textContent).toBe(`${formatNumber(1234)}/${formatNumber(5678)}`);
    act(() => setLanguage('en'));
    expect(badge.textContent).toBe(`${formatNumber(1234)}/${formatNumber(5678)}`);
    expect(badge.getAttribute('aria-label')).toBe(t('Checkliste: {checked} von {total} erledigt', {
      checked: formatNumber(1234), total: formatNumber(5678),
    }));
  } finally {
    act(() => root.unmount());
    setLanguage(previous);
    vi.unstubAllGlobals();
  }
});

it('uses the same non-interactive progress badge in all four task views', () => {
  const now = new Date(2026, 9, 25, 12);
  const task = projectEvents([{
    seq: 1, id: 'created', timestamp: now.toISOString(), undone: false,
    type: 'TASK_CREATED', payload: { taskId: 'A', title: 'Task A',
      configuredStart: now.toISOString(), createdAt: now.toISOString() },
  }], now).tasks.A;
  task.checklistProgress = { checked: 3, total: 7 };
  task.predecessorIds = ['P'];
  task.allPredecessorIds = ['P'];
  const noop = vi.fn();
  const editor = { taskId: null, value: '', onStart: noop, onChange: noop, onCommit: noop, onCancel: noop };
  const shared = {
    openTasks: [task], now, listEntries: [{ kind: 'task' as const, key: 'task:A', task }],
    titleEditor: editor, dateEditor: editor, highlights: {}, deletionPreview: [],
    selectedTaskId: null, selectedEdgeKeys: [], draggedTaskId: null, activeDropTargetKey: null, isAltDrag: false,
    onSelectTask: noop, onClearTaskSelection: noop, onSelectEdge: noop, onClearEdgeSelection: noop,
    setActiveDropTargetKey: noop, onSetConfiguredDate: noop, onToggleActive: noop,
    onContextMenuTask: noop, onDragStartTask: noop, onAddPredecessor: noop, onRemoveDependencyBetween: noop,
  };
  const views = [
    <ListView {...shared} movedItemKey={null} />,
    <NetworkPlanView {...shared} />,
    <GanttView {...shared} />,
    <MiniCornerView tasks={[task]} titleEditor={editor} onSelectAndRestore={noop} onRestoreWindow={noop}
      onResubmitTasks={noop} onCompleteTask={noop} onToggleActive={noop} onContextMenuTask={noop}
      newTaskTitle="" setNewTaskTitle={noop} newTaskInputRef={React.createRef()} snapshotReady onCreateTask={noop} />,
  ];
  for (const [index, view] of views.entries()) {
    const element = document.createElement('div');
    element.innerHTML = renderToStaticMarkup(view);
    const badges = element.querySelectorAll('[data-task-checklist-badge]');
    expect(badges, `view ${index}`).toHaveLength(1);
    const badge = badges[0];
    expect(badge.textContent).toBe('3/7');
    expect(badge.closest('button')).toBeNull();
    expect(badge.getAttribute('tabindex')).toBeNull();
    if (index === 0) {
      expect(badge.parentElement?.querySelector('[data-edge-key]')).not.toBeNull();
      expect(badge.compareDocumentPosition(element.querySelector('[data-edge-key]')!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    if (index === 1) expect(badge.parentElement?.querySelector('button[aria-label]')).not.toBeNull();
    if (index === 2) expect(badge.closest('[data-gantt-list]')).not.toBeNull();
    if (index === 3) {
      expect(badge.closest('[data-mini-task-id="A"]')).not.toBeNull();
      expect(badge.nextElementSibling?.classList.contains('group-hover:visible')).toBe(true);
    }
  }
});
