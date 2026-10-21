import { expect, it, vi } from 'vitest';
import { taskInteractions } from './taskInteractions';
import { normalizeTitleInput, TITLE_LIMIT } from '../domain/input';
it('selects once on click, never on mousedown', () => {
  const select=vi.fn();
  const handlers=taskInteractions('t1','task:t1',{onSelectTask:select,onDragStartTask:vi.fn(),onDragEndTask:vi.fn(),onAltKeyChange:vi.fn(),isAltDrag:false,draggedTaskId:null,setDraggedTaskId:vi.fn(),setActiveDropTargetKey:vi.fn(),onAddPredecessor:vi.fn(),onRemoveDependencyBetween:vi.fn(),onContextMenuTask:vi.fn()});
  expect(handlers.onMouseDown).toBeUndefined();
  handlers.onClick({stopPropagation:vi.fn(),target:{closest:()=>null},shiftKey:true} as any);
  expect(select).toHaveBeenCalledTimes(1);
});
it('limits long pasted titles centrally without splitting Unicode code points', () => {
  expect(normalizeTitleInput('x'.repeat(3000)).length).toBe(TITLE_LIMIT);
  expect(normalizeTitleInput('line1\nline2')).toBe('line1 line2');
});
