// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDetailPanel } from './TaskDetailPanel';
import { taskMenuItems } from './TaskContextMenu';
import type { TaskDescriptionEditorProps } from './editor/TaskDescriptionEditor';
import type { TaskLogSectionProps } from './TaskLogSection';
import type { EditorContextMenu } from './editor/types';
import type { TaskState } from '../domain/types';
import { installTaskPointerDrag } from '../hooks/taskPointerDrag';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { formatDate, t } from '../i18n';

const mocks = vi.hoisted(() => ({
  showMenu: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(),
  editorFiles: vi.fn(), logFiles: vi.fn(), execute: vi.fn(),
}));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: {
  showTaskContextMenu: mocks.showMenu, onFileDrop: mocks.subscribe,
} }));
const context: EditorContextMenu = {
  items: [
    { id: 'copy', label: 'Copy fixture', disabled: false },
    { id: 'editor-separator', label: '', disabled: false, separator: true },
    { id: 'paste', label: 'Paste fixture', disabled: true },
  ],
  execute: mocks.execute,
};
const pathContext: EditorContextMenu = {
  target: { kind: 'path', value: 'C:\\fixture.txt' },
  items: [{ id: 'open-explorer', label: 'Explorer fixture', disabled: false }],
  execute: mocks.execute,
};
vi.mock('./editor/TaskDescriptionEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return { TaskDescriptionEditor: forwardRef(function Editor(props: TaskDescriptionEditorProps, ref) {
    useImperativeHandle(ref, () => ({ insertFiles: mocks.editorFiles, focus: vi.fn() }));
    return <div data-editor contentEditable suppressContentEditableWarning tabIndex={0}
      onContextMenu={event => props.onContextMenu(event, context)}
      onKeyDown={event => { if (event.key === 'Escape') props.onEscape(); }}>
      <span data-editor-text>{props.description}</span>
      <span data-editor-path onContextMenu={event => {
        event.stopPropagation(); props.onContextMenu(event, pathContext);
      }}>C:\fixture.txt</span>
    </div>;
  }) };
});
vi.mock('./TaskLogSection', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return { TaskLogSection: forwardRef(function Log(props: TaskLogSectionProps, ref) {
    useImperativeHandle(ref, () => ({ insertFiles: mocks.logFiles, focus: vi.fn() }));
    return <textarea data-log defaultValue={props.entries.map(entry => entry.text).join('\n')}
      onContextMenu={event => props.onContextMenu(event, context)} />;
  }) };
});

const task: TaskState = {
  id: '26-101', title: 'Task fixture', description: 'Description fixture', logEntries: [],
  checklistProgress: null, creationOrder: 1, createdAt: '2026-10-25T10:00:00Z',
  configuredStart: '2026-10-25T10:00:00Z', calculatedStart: null,
  effectiveStart: '2026-10-25T10:00:00Z', effectiveDateKey: '2026-10-25',
  predecessorIds: ['26-100'], allPredecessorIds: ['26-100'], successorIds: [],
  isActive: false, completed: false, isDeemphasized: false,
};
const makeProps = () => {
  const editor = () => ({ taskId: null, value: '', onChange: vi.fn(), onStart: vi.fn(),
    onCommit: vi.fn(), onCancel: vi.fn() });
  return {
    task, titleEditor: editor(), dateEditor: editor(), onClose: vi.fn(),
    onDescriptionChange: vi.fn(async () => {}), onAddLog: vi.fn(async () => {}), onError: vi.fn(),
    onRemoveLog: vi.fn(async () => {}),
    onToggleActive: vi.fn(), onSetConfiguredDate: vi.fn(), onRemovePredecessor: vi.fn(),
    onCompleteTask: vi.fn(), onReopenTask: vi.fn(),
    interactions: {
      draggedTaskId: null, selectedTaskId: null, selectedEdgeKeys: [], highlights: {},
      deletionPreview: [], activeDropTargetKey: null, isAltDrag: false,
      onDragStartTask: vi.fn(), setActiveDropTargetKey: vi.fn(), onAddPredecessor: vi.fn(),
      onRemoveDependencyBetween: vi.fn(), onSelectTask: vi.fn(), onContextMenuTask: vi.fn(),
      onSelectEdge: vi.fn(), onClearEdgeSelection: vi.fn(), onClearTaskSelection: vi.fn(),
      onSetConfiguredDate: vi.fn(), onToggleActive: vi.fn(),
    },
  } satisfies React.ComponentProps<typeof TaskDetailPanel>;
};
let host: HTMLDivElement, root: Root;
class FixturePointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('PointerEvent', FixturePointerEvent);
  mocks.showMenu.mockResolvedValue(''); mocks.execute.mockResolvedValue(undefined);
  mocks.subscribe.mockReturnValue(mocks.unsubscribe);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = (props: React.ComponentProps<typeof TaskDetailPanel>) => act(() => root.render(<TaskDetailPanel {...props} />));
// Compare CSSOM values: jsdom normalizes nested min/max expressions.
const cssHeight = (value: string) => {
  const control = document.createElement('div'); control.style.height = value; return control.style.height;
};
const cssWidth = (value: string) => {
  const control = document.createElement('div'); control.style.width = value; return control.style.width;
};
it('keeps one rem-sized toggle plus its border and full-width content without a divider strip', () => {
  const props = { ...makeProps(), onToggle: vi.fn() };
  render({ ...props, open: false });
  const pane = host.querySelector<HTMLElement>('aside')!;
  const toggle = pane.querySelector<HTMLButtonElement>(':scope > button[data-detail-toggle]')!;
  expect(host.querySelector('[data-detail-divider]')).toBeNull();
  expect(toggle.parentElement).toBe(pane);
  expect(pane.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
  expect(pane.className).toContain('transition-[width]');
  expect(toggle.className).toContain('top-3 right-0');
  expect(toggle.classList.contains('w-7')).toBe(true);
  expect(toggle.querySelector('svg')!.classList.contains('w-5')).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[data-editor]')).toBeNull();
  act(() => toggle.click());
  expect(props.onToggle).toHaveBeenCalledOnce();
  render({ ...props, open: true });
  expect(pane.querySelector(':scope > button[data-detail-toggle]')).toBe(toggle);
  expect(pane.style.width).toBe('var(--detail-width)');
  expect(pane.style.getPropertyValue('--detail-width')).toBe('min(560px, max(200px, calc(100vw - 300px)))');
  const resize = pane.querySelector<HTMLElement>(':scope > [data-resize-handle="vertical"]')!;
  expect(resize.classList.contains('right-0')).toBe(true);
  expect(resize.classList.contains('top-12')).toBe(true);
  expect(resize.classList.contains('top-3')).toBe(false);
  const content = host.querySelector('header')!.parentElement!;
  expect(content.parentElement).toBe(pane);
  expect(content.style.width).toBe('var(--detail-width)');
  expect(content.classList.contains('left-0')).toBe(true);
  expect(content.classList.contains('right-8')).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('[data-editor]')).not.toBeNull();
  render({ ...props, open: false });
  expect(pane.querySelector(':scope > button[data-detail-toggle]')).toBe(toggle);
  expect(pane.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
});

it.each([null, '2026-10-28T10:00:00Z'])('keeps configured and effective dates in one responsive row with calculatedStart=%s', calculatedStart => {
  const props = makeProps(); render({ ...props, task: { ...task, calculatedStart } });
  const row = host.querySelector<HTMLElement>('[data-detail-dates]')!;
  const configured = row.querySelector(`button[aria-label="${t('Startdatum {id} bearbeiten', { id: task.id })}"]`)!;
  const arrow = row.querySelector('svg.lucide-arrow-right')!;
  const effective = row.querySelector<HTMLElement>(`span[title="${t('Berechnet')}"]`)!;
  expect(row.classList.contains('flex')).toBe(true);
  expect(row.classList.contains('whitespace-nowrap')).toBe(true);
  expect(row.classList.contains('flex-wrap')).toBe(false);
  expect(row.querySelectorAll('.detail-date-label')).toHaveLength(2);
  expect([...row.querySelectorAll('.detail-date-label')].map(label => label.textContent)).toEqual([
    `${t('Konfiguriert')}:`, `${t('Berechnet')}:`,
  ]);
  expect(arrow.getAttribute('aria-hidden')).toBe('true');
  expect(arrow.classList.contains('shrink-0')).toBe(true);
  expect(configured.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(arrow.compareDocumentPosition(effective) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(configured.textContent).toBe(formatDate(task.configuredStart));
  expect(configured.classList.contains('text-[10px]')).toBe(true);
  expect(effective.textContent).toBe(formatDate(calculatedStart ?? task.effectiveStart));
  const content = row.closest('header')!.parentElement!;
  expect(content.style.containerType).toBe('inline-size');
  expect(content.style.containerName).toBe('task-detail');
  // jsdom cannot evaluate container queries; verify the responsive CSS contract instead.
  expect(content.querySelector('style')!.textContent).toMatch(
    /@container\s+task-detail\s*\(max-width:\s*440px\)\s*\{\s*\.detail-date-label\s*\{\s*display:\s*none;/,
  );
  render({ ...props, task: { ...task, calculatedStart }, dateEditor: { ...props.dateEditor, taskId: task.id } });
  const input = row.querySelector('input')!;
  expect(input.classList.contains('w-24')).toBe(true);
  expect(row.querySelector('svg.lucide-arrow-right')).toBe(arrow);
  expect(row.querySelector(`span[title="${t('Berechnet')}"]`)).toBe(effective);
});

it('gives the editor remaining column height without an outer scroll or padding wrapper', () => {
  render(makeProps());
  const section = host.querySelector('[data-editor]')!.parentElement!;
  const content = section.parentElement!;
  expect(section.tagName).toBe('SECTION');
  for (const name of ['flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden']) {
    expect(section.classList.contains(name)).toBe(true);
  }
  expect([...section.classList].some(name => /^(p[xytrbl]?-|overflow-[xy]-)/.test(name))).toBe(false);
  for (const name of ['flex', 'flex-col', 'min-h-0']) expect(content.classList.contains(name)).toBe(true);
  expect(content.querySelector('header')!.classList.contains('shrink-0')).toBe(true);
  const logArea = host.querySelector('[data-log]')!.parentElement!;
  expect(logArea.parentElement).toBe(content);
  expect(logArea.classList.contains('shrink-0')).toBe(true);
  expect(logArea.style.height).toBe(cssHeight('min(224px, max(100px, calc(100% - 290px)))'));
  const resize = section.nextElementSibling!;
  expect(resize.getAttribute('data-resize-handle')).toBe('horizontal');
  expect(resize.nextElementSibling).toBe(logArea);
});

it('resizes panel and log independently with real mouse pointers without starting native task gestures', async () => {
  const props = makeProps(); render(props);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const end = vi.fn(); const cleanup = installTaskPointerDrag(end, vi.fn());
  const pane = host.querySelector<HTMLElement>('aside')!;
  const vertical = pane.querySelector<HTMLElement>('[data-resize-handle="vertical"]')!;
  const horizontal = pane.querySelector<HTMLElement>('[data-resize-handle="horizontal"]')!;
  const logArea = host.querySelector('[data-log]')!.parentElement!;
  const pointer = (target: EventTarget, type: string, x: number, y: number) => act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0,
      pointerId: 5, isPrimary: true, clientX: x, clientY: y }));
  });
  try {
    pointer(vertical, 'pointerdown', 100, 100); pointer(window, 'pointermove', 140, 900);
    pointer(window, 'pointerup', 140, 900);
    expect(vertical.getAttribute('aria-valuenow')).toBe('600');
    expect(horizontal.getAttribute('aria-valuenow')).toBe('224');
    expect(pane.style.getPropertyValue('--detail-width')).toBe('min(600px, max(200px, calc(100vw - 300px)))');
    pointer(horizontal, 'pointerdown', 100, 200); pointer(window, 'pointermove', 900, 160);
    pointer(window, 'pointerup', 900, 160);
    expect(horizontal.getAttribute('aria-valuenow')).toBe('264');
    expect(vertical.getAttribute('aria-valuenow')).toBe('600');
    expect(logArea.style.height).toBe(cssHeight('min(264px, max(100px, calc(100% - 290px)))'));
    expect(props.interactions.onDragStartTask).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(props.onDescriptionChange).not.toHaveBeenCalled(); expect(props.onAddLog).not.toHaveBeenCalled();
    await openMenu(vertical); await openMenu(horizontal);
    expect(mocks.showMenu).not.toHaveBeenCalled();
  } finally { cleanup(); }
});

it('clamps keyboard resize to responsive parent and panel bounds', () => {
  vi.stubGlobal('innerWidth', 500);
  vi.stubGlobal('innerHeight', 420);
  render(makeProps());
  const vertical = host.querySelector<HTMLElement>('[data-resize-handle="vertical"]')!;
  const horizontal = host.querySelector<HTMLElement>('[data-resize-handle="horizontal"]')!;
  const key = (handle: HTMLElement, value: string) => act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });
  expect(vertical.getAttribute('aria-valuemin')).toBe('250');
  expect(vertical.getAttribute('aria-valuemax')).toBe('250');
  key(vertical, 'End'); expect(vertical.getAttribute('aria-valuenow')).toBe('250');
  key(vertical, 'ArrowLeft'); expect(vertical.getAttribute('aria-valuenow')).toBe('250');
  expect(horizontal.getAttribute('aria-valuemax')).toBe('130');
  key(horizontal, 'End'); expect(horizontal.getAttribute('aria-valuenow')).toBe('130');
  key(horizontal, 'Home'); expect(horizontal.getAttribute('aria-valuenow')).toBe('100');
  key(horizontal, 'ArrowDown'); expect(horizontal.getAttribute('aria-valuenow')).toBe('100');
});

it('allows Explorer drops to bubble to the Wails window listener without task mutations', () => {
  const props = makeProps(); render(props);
  const nativeDrop = vi.fn(); window.addEventListener('drop', nativeDrop);
  const nativeOver = vi.fn(); window.addEventListener('dragover', nativeOver);
  try {
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    act(() => host.querySelector('aside')!.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    expect(nativeOver).toHaveBeenCalledOnce();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [{}] } });
    act(() => host.querySelector('aside')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(nativeDrop).toHaveBeenCalledOnce();
    expect(props.interactions.onAddPredecessor).not.toHaveBeenCalled();
  } finally { window.removeEventListener('drop', nativeDrop); window.removeEventListener('dragover', nativeOver); }
});

const openMenu = async (element: Element) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => { element.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
};

it('shows the no-task placeholder without editors, task menu or file insertion', async () => {
  const props = makeProps(); render({ ...props, task: null });
  expect(host.textContent).toContain(t('Task auswählen, um Details, Beschreibung und Log anzuzeigen'));
  expect(host.querySelector('[data-editor],[data-log],[data-task-drag]')).toBeNull();
  await openMenu(host.querySelector('aside')!);
  expect(mocks.showMenu).not.toHaveBeenCalled();
  mocks.subscribe.mock.calls[0][0](10, 10, ['C:\\fixture.txt']);
  expect(mocks.editorFiles).not.toHaveBeenCalled(); expect(mocks.logFiles).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(props.onClose).toHaveBeenCalledOnce();
});

it('uses task menus outside editors and editor-only menus inside description and log', async () => {
  const props = makeProps(); render(props);
  mocks.showMenu.mockResolvedValueOnce('remove:26-100');
  await openMenu(host.querySelector('header')!);
  expect(mocks.showMenu).toHaveBeenLastCalledWith(taskMenuItems(task), undefined);
  expect(props.onRemovePredecessor).toHaveBeenCalledWith(task.id, '26-100');
  expect(props.interactions.onContextMenuTask).not.toHaveBeenCalled();
  for (const selector of ['[data-editor]', '[data-log]']) {
    mocks.showMenu.mockResolvedValueOnce('copy');
    await openMenu(host.querySelector(selector)!);
    expect(mocks.showMenu).toHaveBeenLastCalledWith(context.items, undefined);
    expect(mocks.execute).toHaveBeenLastCalledWith('copy');
    mocks.showMenu.mockResolvedValueOnce('complete');
    await openMenu(host.querySelector(selector)!);
    expect(props.onCompleteTask).not.toHaveBeenCalled();
  }
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain('Copy fixture');
  mocks.showMenu.mockResolvedValueOnce('complete');
  await openMenu(host.querySelector('aside')!);
  expect(mocks.showMenu).toHaveBeenLastCalledWith(taskMenuItems(task), undefined);
  expect(props.onCompleteTask).toHaveBeenCalledWith(task.id);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
});

it('passes only the target-specific path menu without prepending task or editing actions', async () => {
  const props = makeProps(); render(props);
  mocks.showMenu.mockResolvedValueOnce('open-explorer');
  await openMenu(host.querySelector('[data-editor-path]')!);
  expect(mocks.showMenu).toHaveBeenCalledOnce();
  expect(mocks.showMenu).toHaveBeenLastCalledWith(pathContext.items, undefined);
  expect(mocks.execute).toHaveBeenCalledWith('open-explorer');
  expect(props.interactions.onContextMenuTask).not.toHaveBeenCalled();
  expect(props.onCompleteTask).not.toHaveBeenCalled();
});

it('ignores cancelled, disabled, separator, unknown and stale native menu results and reports errors', async () => {
  const props = makeProps(); render(props);
  for (const id of ['', 'paste', 'detail:separator', 'editor-separator', 'unknown']) {
    mocks.showMenu.mockResolvedValueOnce(id);
    await openMenu(host.querySelector('[data-editor]')!);
  }
  expect(mocks.execute).not.toHaveBeenCalled();
  let resolve!: (id: string) => void;
  mocks.showMenu.mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
  await openMenu(host.querySelector('[data-editor]')!);
  render({ ...props, task: { ...task, id: '26-102' } });
  await act(async () => { resolve('copy'); });
  expect(mocks.execute).not.toHaveBeenCalled();
  const error = new Error('Native fixture failure'); mocks.showMenu.mockRejectedValueOnce(error);
  await openMenu(host.querySelector('header')!);
  expect(props.onError).toHaveBeenCalledWith(error);
});

it('offers only reopening as a task action for completed tasks', async () => {
  const props = makeProps(); const completed = { ...task, completed: true };
  render({ ...props, task: completed }); mocks.showMenu.mockResolvedValueOnce('reopen');
  await openMenu(host.querySelector('header')!);
  expect(mocks.showMenu).toHaveBeenLastCalledWith(taskMenuItems(completed), undefined);
  expect(taskMenuItems(completed).map(item => item.id)).toEqual(['reopen']);
  expect(props.onReopenTask).toHaveBeenCalledWith(task.id);
});

it('routes native files by panel and log bounds, uses current refs and unsubscribes', () => {
  const props = makeProps(); render(props);
  const panel = host.querySelector('aside')!;
  const logArea = host.querySelector('[data-log]')!.parentElement!;
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 430, top: 20, bottom: 600 } as DOMRect);
  vi.spyOn(logArea, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
  const drop = mocks.subscribe.mock.calls[0][0]; const paths = ['C:\\fixture.txt', 'C:\\image.png'];
  for (const [x, y] of [[9, 100], [431, 100], [100, 19], [100, 601]]) drop(x, y, paths);
  expect(mocks.editorFiles).not.toHaveBeenCalled(); expect(mocks.logFiles).not.toHaveBeenCalled();
  drop(100, 399, paths); expect(mocks.editorFiles).toHaveBeenCalledWith(paths, 100, 399);
  drop(100, 400, paths); expect(mocks.logFiles).toHaveBeenCalledWith(paths, 100, 400);
  render({ ...props, task: { ...task, id: '26-102' } });
  drop(100, 100, paths); expect(mocks.editorFiles).toHaveBeenCalledTimes(2);
  expect(mocks.subscribe).toHaveBeenCalledOnce();
  render({ ...props, task: null }); drop(100, 100, paths);
  expect(mocks.editorFiles).toHaveBeenCalledTimes(2);
  render(props);
  vi.spyOn(host.querySelector('[data-log]')!.parentElement!, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
  const failure = new Error('Native insertion failed');
  mocks.editorFiles.mockImplementationOnce(() => { throw failure; });
  drop(100, 100, paths);
  expect(props.onError).toHaveBeenCalledWith(failure);
  act(() => root.render(null)); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

it('focuses free header space but preserves editor selection and returns focus on editor Escape', () => {
  render(makeProps()); const panel = host.querySelector<HTMLElement>('aside')!;
  const editor = host.querySelector<HTMLElement>('[data-editor]')!;
  editor.focus();
  act(() => editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(document.activeElement).toBe(editor);
  act(() => host.querySelector('header')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(document.activeElement).toBe(panel);
  editor.focus();
  act(() => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(panel);
});

it('starts real pointer gestures only on free header/handle, cancels Escape and blocks inline editing', () => {
  const props = makeProps(); render(props);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const end = vi.fn(); const cleanup = installTaskPointerDrag(end, vi.fn());
  const pointer = (target: Element, type: string, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 30, button: 0 });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    act(() => target.dispatchEvent(event));
  };
  try {
    const header = host.querySelector('header')!;
    expect(host.querySelector('aside')!.hasAttribute('data-task-drag')).toBe(false);
    expect(header.getAttribute('data-task-drag')).toBe(task.id);
    for (const origin of [host.querySelector('aside')!, host.querySelector('[data-editor]')!, host.querySelector('[data-log]')!]) {
      pointer(origin, 'pointerdown', 10); pointer(header, 'pointermove', 30);
    }
    expect(props.interactions.onDragStartTask).not.toHaveBeenCalled();
    for (const origin of [header, host.querySelector('[data-drag-handle]')!]) {
      pointer(origin, 'pointerdown', 10); pointer(header, 'pointermove', 30);
      expect(props.interactions.onDragStartTask).toHaveBeenLastCalledWith(expect.anything(), task.id);
      expect(vi.mocked(props.interactions.onDragStartTask).mock.calls.at(-1)![0].target).toBe(header);
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    }
    expect(props.interactions.onDragStartTask).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
    render({ ...props, titleEditor: { ...props.titleEditor, taskId: task.id } });
    pointer(header, 'pointerdown', 10); pointer(header, 'pointermove', 30);
    expect(header.hasAttribute('data-task-drag-disabled')).toBe(true);
    expect(props.interactions.onDragStartTask).toHaveBeenCalledTimes(2);
  } finally { cleanup(); }
});

it('routes pointer drops onto the panel with Alt read at release, not just drag start', () => {
  const props = makeProps(); render({ ...props, interactions: { ...props.interactions, draggedTaskId: 'source' } });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const panel = host.querySelector('aside')!;
  const source = document.createElement('div'); source.setAttribute('data-task-drag', 'source'); host.append(source);
  const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => panel) });
  const cleanup = installTaskPointerDrag(vi.fn(), vi.fn());
  const pointer = (type: string, x: number, altKey = false) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 30, button: 0, altKey });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    act(() => source.dispatchEvent(event));
  };
  try {
    pointer('pointerdown', 10); pointer('pointermove', 30); pointer('pointerup', 30, true);
    expect(props.interactions.onRemoveDependencyBetween).toHaveBeenCalledWith('source', task.id);
    expect(props.interactions.onAddPredecessor).not.toHaveBeenCalled();
    pointer('pointerdown', 10); pointer('pointermove', 30, true); pointer('pointerup', 30);
    expect(props.interactions.onAddPredecessor).toHaveBeenCalledWith('source', task.id);
    expect(props.interactions.setActiveDropTargetKey).toHaveBeenCalledWith(`detail-task:${task.id}`);
  } finally {
    cleanup();
    if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
    else delete (document as Partial<Document>).elementFromPoint;
  }
});

it('keeps global task and undo shortcuts out of editor descendants but enables them on the focused panel', () => {
  const props = makeProps();
  const actions = {
    handleUndo: vi.fn(), handleRedo: vi.fn(), handleRemoveSelectedEdges: vi.fn(),
    handleToggleActive: vi.fn(), handleCompleteTask: vi.fn(), handleReopenTask: vi.fn(),
    handleSetConfiguredDate: vi.fn(),
  };
  function Harness() {
    useGlobalShortcuts({
      selection: { selectedTaskId: task.id, setSelectedTaskId: vi.fn(), selectedEdgeKeys: [],
        clearEdgeSelection: vi.fn(), contextMenu: null, setContextMenu: vi.fn() },
      actions, state: { tasks: { [task.id]: task }, openTasks: [task], completedTasks: [],
        listEntries: [{ kind: 'task', key: task.id, task }], canUndo: true, canRedo: false,
        activeEventCount: 1, totalEventCount: 1, openTaskCountAtYesterdayEnd: 1, nextTaskId: '26-102' },
      showSettingsModal: false, showShortcutsModal: false, setShowShortcutsModal: vi.fn(),
      isMiniMode: false, miniTaskIds: [], snapshotReady: true,
      listScrollRef: { current: null }, newTaskInputRef: { current: null },
      startInlineEdit: vi.fn(), onMinimize: vi.fn(), onRestore: vi.fn(),
    });
    return <TaskDetailPanel {...props} />;
  }
  act(() => root.render(<Harness />));
  const key = (target: Element, value: string, ctrlKey = false) => {
    const event = new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true });
    act(() => target.dispatchEvent(event)); return event;
  };
  for (const target of [host.querySelector('[data-editor-text]')!, host.querySelector('[data-log]')!]) {
    expect(key(target, 'a').defaultPrevented).toBe(false);
    expect(key(target, 'Delete').defaultPrevented).toBe(false);
    expect(key(target, 'z', true).defaultPrevented).toBe(false);
  }
  expect(actions.handleToggleActive).not.toHaveBeenCalled();
  expect(actions.handleCompleteTask).not.toHaveBeenCalled(); expect(actions.handleUndo).not.toHaveBeenCalled();
  const panel = host.querySelector<HTMLElement>('aside')!; panel.focus();
  expect(key(panel, 'a').defaultPrevented).toBe(true);
  expect(key(panel, 'z', true).defaultPrevented).toBe(true);
  expect(actions.handleToggleActive).toHaveBeenCalledWith(task); expect(actions.handleUndo).toHaveBeenCalledOnce();
});

it.each([true, false])('shows syntax help only in the expanded detail panel while open=%s', open => {
  const onSyntaxHelp = vi.fn();
  render({ ...makeProps(), open, onSyntaxHelp });
  const help = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('Markdown-Syntax')}"]`)!;
  if (!open) {
    expect(help).toBeNull();
    expect(host.querySelector<HTMLElement>('aside')!.style.width).toBe(cssWidth('calc(1.75rem + 1px)'));
    expect(host.querySelectorAll('aside > button')).toHaveLength(1);
    return;
  }
  expect(help.title).toBe(t('Markdown-Syntax'));
  expect(help.classList.contains('right-7')).toBe(true);
  expect(host.querySelector('[data-detail-toggle]')!.classList.contains('right-0')).toBe(true);
  for (const control of [help, host.querySelector('[data-detail-toggle]')!]) {
    expect(control.classList.contains('w-7')).toBe(true);
    expect(control.classList.contains('h-7')).toBe(true);
    expect(control.querySelector('svg')!.classList.contains('w-5')).toBe(true);
  }
  act(() => help.click());
  expect(onSyntaxHelp).toHaveBeenCalledOnce();
});
