// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtocolView } from './ProtocolView';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents } from '../domain/projector';
import type { ProtocolDay } from '../domain/protocol';
import type { InlineEditor } from './inlineEditor';
import { SOURCE_MIME } from './editor/targets';
const now = new Date('2026-10-17T09:00:00Z');
const task = projectEvents([{ seq: 1, id: 'create', timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
  payload: { taskId: 'a', title: 'Task A', configuredStart: now.toISOString(), createdAt: now.toISOString() } }], now).tasks.a;
const days = (count: number): ProtocolDay[] => Array.from({ length: count }, (_, i) => {
  const dateKey = new Date(Date.UTC(2000, 0, i + 1)).toISOString().slice(0, 10);
  return { dateKey, entries: [{ key: `${dateKey}:a`, taskId: 'a', dateKey, actions: [{ key: `log${i}`, timestamp: now.toISOString(), kind: 'log', text: `Note ${i}` }] }] };
});
let element: HTMLDivElement, root: Root;
let props: React.ComponentProps<typeof ProtocolView>;
let measure: ReturnType<typeof vi.spyOn>;
const editor = (): InlineEditor => ({ taskId: null, value: '', onStart: vi.fn(), onChange: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  element = document.createElement('div'); document.body.append(element);
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 280 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => Number.parseFloat(element.firstElementChild?.getAttribute('style')?.match(/height: ([\d.]+)px/)?.[1] ?? '0') });
  measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.hasAttribute('data-protocol-view') ? -element.scrollTop : 0, left: 0, width: 900, height: 280, right: 900, bottom: 280, x: 0, y: 0, toJSON: () => ({}) };
  });
  root = createRoot(element);
  props = { days: days(1000), tasks: { a: task }, scrollRef: { current: element }, now,
    titleEditor: editor(), dateEditor: editor(), selectedTaskId: 'a', selectedTaskIds: ['a'],
    selectedEdgeKeys: [], highlights: {}, deletionPreview: [], draggedTaskId: null, activeDropTargetKey: null,
    isAltDrag: false, setActiveDropTargetKey: vi.fn(), onDragStartTask: vi.fn(), onAddPredecessor: vi.fn(),
    onRemoveDependencyBetween: vi.fn(), onSelectTask: vi.fn(), onContextMenuTask: vi.fn(), onSelectEdge: vi.fn(),
    onClearEdgeSelection: vi.fn(), onClearTaskSelection: vi.fn(), onSetConfiguredDate: vi.fn(), onToggleActive: vi.fn(),
    onOpenTask: vi.fn(), onSelectTaskByKeyboard: vi.fn(), onError: vi.fn(), onNativeMenuChange: vi.fn(), navigationRef: { current: null } };
});
afterEach(() => { act(() => root.unmount()); element.remove(); measure.mockRestore(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = () => act(() => root.render(<ProtocolView {...props} />));
const scroll = (top: number) => act(() => { element.scrollTop = top; element.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(20); });

it('starts at the newest end, renders a bounded window and can reveal the earliest history', () => {
  render();
  expect(element.textContent).toContain('Note 999');
  expect(element.textContent).not.toContain('Note 0');
  expect(element.querySelectorAll('[data-protocol-row]').length).toBeLessThan(35);
  expect(element.scrollTop).toBe(element.scrollHeight - element.clientHeight);
  scroll(0);
  expect(element.textContent).toContain('Note 0');
  expect(element.textContent).not.toContain('Note 999');
  expect(element.querySelectorAll('[data-protocol-row]').length).toBeLessThan(35);
  props = { ...props, days: days(1001) }; render();
  expect(element.scrollTop).toBe(0); // New arrivals do not pull a reader away from old history.
  scroll(element.scrollHeight - element.clientHeight);
  props = { ...props, days: days(1002) }; render();
  expect(element.textContent).toContain('Note 1001');
  expect(element.scrollTop).toBe(element.scrollHeight - element.clientHeight);
});

it('virtualizes thousands of events within a single day and task', () => {
  const single = days(1);
  single[0].entries[0].actions = Array.from({ length: 5000 }, (_, i) => ({ key: `log${i}`, timestamp: now.toISOString(), kind: 'log', text: `Event ${i}` }));
  props = { ...props, days: single }; render();
  expect(element.textContent).toContain('Event 4999');
  expect(element.querySelectorAll('[data-protocol-row]').length).toBeLessThan(35);
  scroll(0); expect(element.textContent).toContain('Event 0');
});

it('keeps only one editor for repeated task headers and retains it when scrolled out of view', () => {
  props = { ...props, days: days(3) }; render();
  const headers = element.querySelectorAll<HTMLElement>('[data-protocol-row="task"]');
  act(() => headers[0].querySelector('[data-task-drag]')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  props = { ...props, titleEditor: { ...props.titleEditor, taskId: 'a', value: 'Edited title' } }; render();
  expect(element.querySelectorAll('[data-task-title-editing="true"]')).toHaveLength(1);
  expect(headers[0].querySelector('[data-task-title-editing="true"]')).not.toBeNull();
  props = { ...props, days: days(1000) }; render(); scroll(element.scrollHeight - element.clientHeight);
  expect(element.querySelectorAll('[data-task-title-editing="true"]')).toHaveLength(1);
  expect(element.querySelector('[data-task-title-editing="true"]')?.textContent).toBe('Edited title');
});

it('navigates repeated occurrences and scrolls to the selected header outside the rendered window', () => {
  render();
  act(() => props.navigationRef.current?.(-1));
  expect(props.onSelectTaskByKeyboard).toHaveBeenCalledWith('a');
  expect(element.querySelector(`[data-protocol-key="${props.days[998].entries[0].key}"]`)).not.toBeNull();
  props = { ...props, selectedTaskId: null }; render();
  act(() => props.navigationRef.current?.(1));
  expect(element.querySelector(`[data-protocol-key="${props.days[0].entries[0].key}"]`)).not.toBeNull();
});

it('opens source context actions, copies source drag payloads and opens task details from actions', async () => {
  const target = { kind: 'path' as const, value: 'C:\\My Project' };
  const single = days(1); single[0].entries[0].actions = [{ key: 'source', timestamp: now.toISOString(), kind: 'source', target }];
  props = { ...props, days: single };
  vi.spyOn(eventBridge, 'getPathKind').mockResolvedValue('directory');
  const show = vi.spyOn(eventBridge, 'showTaskContextMenu').mockResolvedValue('path:vscode');
  const open = vi.spyOn(eventBridge, 'openPathInVSCode').mockResolvedValue();
  await act(async () => root.render(<ProtocolView {...props} />));
  const source = element.querySelector('[data-source-drag]')!;
  await act(async () => source.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(show.mock.calls[0][0].map(item => item.id)).toEqual(['path:explorer', 'path:vscode']);
  expect(open).toHaveBeenCalledWith(target.value);
  expect(props.onNativeMenuChange).toHaveBeenNthCalledWith(1, true);
  expect(props.onNativeMenuChange).toHaveBeenLastCalledWith(false);
  const transfer = { clearData: vi.fn(), setData: vi.fn(), effectAllowed: '' };
  const drag = new Event('dragstart', { bubbles: true }); Object.defineProperty(drag, 'dataTransfer', { value: transfer });
  act(() => source.dispatchEvent(drag));
  expect(transfer.setData).toHaveBeenCalledWith(SOURCE_MIME, JSON.stringify(target));
  expect(props.onDragStartTask).not.toHaveBeenCalled();
  act(() => element.querySelector('[data-protocol-row="action"] > div')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(props.onOpenTask).toHaveBeenCalledWith('a');
});

it('shows event-local hours and minutes from the stored timestamp', () => {
  const timestamp = new Date(2026, 9, 17, 9, 7).toISOString();
  const single = days(1);
  single[0].entries[0].actions = [{ key: 'note', kind: 'log', text: 'An entry', timestamp }];
  props = { ...props, days: single }; render();
  const time = element.querySelector('time')!;
  expect(time.textContent).toBe('09:07');
  expect(time.dateTime).toBe(timestamp);
});

it('keeps the scrolled date visible after its divider is virtualized away and updates at day boundaries', () => {
  const history = days(2);
  history[0].entries[0].actions = Array.from({ length: 300 }, (_, i) => ({
    key: `a${i}`, timestamp: now.toISOString(), kind: 'log', text: `First ${i}`,
  }));
  props = { ...props, days: history }; render();
  const context = () => document.querySelector('[data-date-context]')!;
  scroll(0);
  expect(context().textContent).toContain(history[0].dateKey);
  const overlayNode = context();
  expect(element.contains(overlayNode)).toBe(false);
  scroll(20);
  expect(context()).toBe(overlayNode);
  expect((element.querySelector('[data-protocol-row="date"]') as HTMLElement).style.top).toBe('0px');
  scroll(2000);
  expect(element.querySelectorAll('[data-protocol-row="date"]')).toHaveLength(0);
  expect(context().getAttribute('data-date-context')).toBe(history[0].dateKey);
  const lastDay = element.scrollHeight - 116;
  scroll(lastDay - 20);
  expect(context().getAttribute('data-date-context')).toBe(history[0].dateKey);
  // The incoming divider pushes the preceding drop target out without overlap.
  expect((context() as HTMLElement).style.transform).toBe('translateY(-20px)');
  scroll(lastDay);
  expect(context().textContent).toContain(history[1].dateKey);
  scroll(2000);
  expect(context().textContent).toContain(history[0].dateKey);
});
