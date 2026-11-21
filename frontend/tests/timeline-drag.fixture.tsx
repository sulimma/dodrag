import { ProjectContext } from '../src/components/Projects';
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ListView } from '../src/components/ListView';
import { useTaskDrag, type DragIdentity } from '../src/hooks/useTaskDrag';
import { projectEvents } from '../src/domain/projector';
import type { StoredEvent } from '../src/domain/types';
import '../src/index.css';

document.body.style.zoom = new URL(location.href).searchParams.get('zoom') ?? '1';
const now = new Date(2026, 10, 11, 7);
const events: StoredEvent[] = ['A', 'B', 'C', 'D'].map((taskId, index) => ({
 seq: index + 1, id: taskId, timestamp: now.toISOString(), undone: false, type: 'TASK_CREATED',
 payload: { taskId, title: `Task ${taskId}`, configuredStart: new Date(2026, 10, 12, 9).toISOString(), createdAt: now.toISOString() },
}));
const projectFixture = new URL(location.href).searchParams.has('projectLabels');
if (projectFixture) {
  events.push({ type: 'DEPENDENCY_ADDED', payload: { taskId: 'B', predecessorId: 'A' }, id: 'edge', seq: 5, timestamp: now.toISOString(), undone: false });
  const task = events[1];
  if (task.type === 'TASK_CREATED') task.payload.title = 'A long task title '.repeat(12);
}
const noop = () => {};
const editor = { taskId: null, value: '', onStart: noop, onChange: noop, onCommit: noop, onCancel: noop };
function Fixture() {
 const [moves, setMoves] = useState<string[]>([]);
 const [selected, setSelected] = useState<string | null>(null);
 const identity = useRef<DragIdentity | null>(null);
 const state = projectEvents(events, now);
 const drag = useTaskDrag({ mutationBusy: useRef(false), snapshotConfirmed: useRef(true), databaseIdentity: useRef('fixture') },
  { selectedTaskIds: selected ? [selected] : [], setSelectedTaskId: setSelected, clearEdgeSelection: noop }, state.tasks, identity);
 return <main style={{ padding: 40, width: 800 }}>
  <div style={{ position: 'fixed', right: 0, top: 0 }}><output id="target">{drag.activeDropTargetKey}</output><output id="moves">{moves.join('|')}</output></div>
  <ProjectContext.Provider value={projectFixture ? { projects: new Map([['p', { projectId: 'p', code: 'STEUER26', color: '#bb88dd', summary: '', description: '' }]]), members: new Map([['B', new Set(['p'])]]), selectedIds: [], selectedLabels: [], select: noop, details: noop, menu: noop, remove: noop } : null}>
  <ListView {...drag} listEntries={state.listEntries} movedItemKey={null} titleEditor={editor} dateEditor={editor}
   selectedTaskId={selected} selectedEdgeKeys={[]} highlights={{}} deletionPreview={[]} onSelectTask={setSelected}
   onSelectEdge={noop} onClearEdgeSelection={noop} onClearTaskSelection={noop} onContextMenuTask={noop}
   onSetConfiguredDate={() => setMoves(old => [...old, 'date'])} onToggleActive={noop}
   onAddPredecessor={() => setMoves(old => [...old, 'dependency'])} onRemoveDependencyBetween={noop}
   onInsertTask={(id, target, side) => setMoves(old => [...old, `task:${id}:${target}:${side}`])}
   timeline={{ selectedMarkerId: null, editingMarkerId: null, editingValue: '', select: noop, startEdit: noop,
    changeEdit: noop, commitEdit: async () => {}, cancelEdit: noop, remove: async () => {}, dropOnDate: noop,
    createAtGap: (id, side) => setMoves(old => [...old, `marker:${id}:${side}`]), bindTask: noop }} />
 </ProjectContext.Provider></main>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
