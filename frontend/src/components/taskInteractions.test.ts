import { expect, it, vi } from 'vitest';
import { draggedTaskIdOf, taskInteractions } from './taskInteractions';
import { normalizeTitleInput, TITLE_LIMIT } from '../domain/input';
const drop = (handlers: ReturnType<typeof taskInteractions>, altKey = false) => {
  const event = {
    altKey,
    currentTarget: { contains: () => false } as unknown as HTMLElement,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { types: ['text/plain'], getData: () => 'A', dropEffect: '' },
  };
  handlers.onDrop(event as any);
  return event;
};
it('forwards every drop source so the mutation layer owns self-edge and group filtering', () => {
  const add = vi.fn(), remove = vi.fn();
  const actions = { onDragStartTask: vi.fn(), draggedTaskId: 'A', setActiveDropTargetKey: vi.fn(),
    onAddPredecessor: add, onRemoveDependencyBetween: remove };
  const own = taskInteractions('A', 'task:A', { ...actions, onSelectTask: vi.fn(), isAltDrag: false, onContextMenuTask: vi.fn() });
  const foreign = taskInteractions('B', 'task:B', { ...actions, onSelectTask: vi.fn(), isAltDrag: false, onContextMenuTask: vi.fn() });
  drop(own);
  expect(add).toHaveBeenCalledWith('A', 'A');
  drop(foreign);
  expect(add).toHaveBeenCalledWith('A', 'B');
  drop(foreign, true);
  expect(remove).toHaveBeenCalledWith('A', 'B');
});
it('exposes a source marker and lets native Files drops bubble without creating dependencies', () => {
  const add = vi.fn(), remove = vi.fn(), highlight = vi.fn();
  const handlers = taskInteractions('B', 'task:B', {
    onDragStartTask: vi.fn(), draggedTaskId: 'A', setActiveDropTargetKey: highlight,
    onAddPredecessor: add, onRemoveDependencyBetween: remove,
    onSelectTask: vi.fn(), isAltDrag: false, onContextMenuTask: vi.fn(),
  });
  expect(handlers['data-source-task-id']).toBe('B');
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), altKey: true,
    dataTransfer: { types: ['Files'], getData: vi.fn(() => 'A'), dropEffect: 'copy' } };
  handlers.onDragOver(event as any); handlers.onDrop(event as any);
  expect(event.preventDefault).toHaveBeenCalledTimes(2);
  expect(event.stopPropagation).not.toHaveBeenCalled();
  expect(event.dataTransfer.getData).not.toHaveBeenCalled();
  expect(event.dataTransfer.dropEffect).toBe('copy');
  expect(highlight).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});
it('prefers the frozen drag id and falls back to the local transfer value', () => {
  const transfer = { getData: () => 'A' } as unknown as DataTransfer;
  expect(draggedTaskIdOf({ dataTransfer: transfer }, 'B')).toBe('B');
  expect(draggedTaskIdOf({ dataTransfer: transfer }, null)).toBe('A');
  expect(draggedTaskIdOf({ dataTransfer: { getData: () => '' } as unknown as DataTransfer }, null)).toBeNull();
});
it('selects once on click, never on mousedown', () => {
  const select=vi.fn();
  const handlers=taskInteractions('t1','task:t1',{onSelectTask:select,onDragStartTask:vi.fn(),isAltDrag:false,draggedTaskId:null,setActiveDropTargetKey:vi.fn(),onAddPredecessor:vi.fn(),onRemoveDependencyBetween:vi.fn(),onContextMenuTask:vi.fn()});
  expect(handlers.onMouseDown).toBeUndefined();
  handlers.onClick({stopPropagation:vi.fn(),target:{closest:()=>null},shiftKey:true} as any);
  expect(select).toHaveBeenCalledTimes(1);
});
it('limits long pasted titles centrally without splitting Unicode code points', () => {
  expect(normalizeTitleInput('x'.repeat(3000)).length).toBe(TITLE_LIMIT);
  expect(normalizeTitleInput('line1\nline2')).toBe('line1 line2');
});
