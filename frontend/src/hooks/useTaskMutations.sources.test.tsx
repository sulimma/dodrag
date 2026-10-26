import { afterEach, expect, it, vi } from 'vitest';
import { useTaskMutations } from './useTaskMutations';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents } from '../domain/projector';
import type { StoredEvent } from '../domain/types';
import type { EditorTarget } from '../components/editor/types';

const now = new Date('2026-10-26T12:00:00.000Z');
const events: StoredEvent[] = ['A', 'B', 'C'].flatMap((taskId, index) => [{
  seq: index * 2 + 1, id: `create-${taskId}`, timestamp: now.toISOString(), undone: false,
  type: 'TASK_CREATED' as const,
  payload: { taskId, title: taskId, configuredStart: now.toISOString(), createdAt: now.toISOString() },
}, {
  seq: index * 2 + 2, id: `description-${taskId}`, timestamp: now.toISOString(), undone: false,
  type: 'TASK_DESCRIPTION_SET' as const, payload: { taskId, description: `Description ${taskId}` },
}]);
const source: EditorTarget = { kind: 'url', value: 'https://example.com/source' };
const database = (confirmed = events) => ({
  databaseIdentity: { current: 'fixture.db' }, confirmedEvents: { current: confirmed },
  mutate: vi.fn((operation: () => Promise<StoredEvent[]>) => operation()),
});
const actionsFor = (db: ReturnType<typeof database>, selectedTaskIds: string[] = []) => useTaskMutations(db, {
  selectedTaskIds, setSelectedTaskIds: vi.fn(), clearEdgeSelection: vi.fn(),
}, projectEvents(events, now), now, { current: null }, vi.fn(), vi.fn());
afterEach(() => vi.restoreAllMocks());

it('appends sources to every selected target in one atomic description batch', async () => {
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events);
  const single = vi.spyOn(eventBridge, 'appendEvent');
  const db = database();
  await actionsFor(db, ['B', 'A', 'B', 'missing']).handleAppendSources('A', [source]);
  expect(db.mutate).toHaveBeenCalledOnce(); expect(append).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledWith([
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'B', description: 'Description B\n\n<https://example.com/source>' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'A', description: 'Description A\n\n<https://example.com/source>' } },
  ]);
  expect(single).not.toHaveBeenCalled();
});

it('changes only an unselected drop target and retains the order of multiple sources', async () => {
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events);
  await actionsFor(database(), ['A', 'B']).handleAppendSources('C', [source,
    { kind: 'url', value: 'mailto:person@example.com' }]);
  expect(append).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledWith([{ type: 'TASK_DESCRIPTION_SET', payload: {
    taskId: 'C', description: 'Description C\n\n<https://example.com/source>\n\n<mailto:person@example.com>',
  } }]);
});

it('does not queue empty sources or a missing target', async () => {
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events), db = database();
  const actions = actionsFor(db);
  await actions.handleAppendSources('A', []);
  await actions.handleAppendSources('missing', [source]);
  expect(db.mutate).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
});

it('validates the complete source list before queuing any group changes', async () => {
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events), db = database();
  await expect(actionsFor(db, ['A', 'B']).handleAppendSources('A', [source,
    { kind: 'path', value: 'https://example.com/not-a-path' }])).rejects.toThrow();
  expect(db.mutate).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
});

it('reads confirmed descriptions inside the queued operation and freezes sources at admission', async () => {
  const append = vi.spyOn(eventBridge, 'appendBatch').mockResolvedValue(events), db = database();
  let queued!: () => Promise<StoredEvent[]>, finish!: (value: StoredEvent[]) => void;
  db.mutate.mockImplementation(operation => {
    queued = operation;
    return new Promise<StoredEvent[]>(resolve => { finish = resolve; });
  });
  const sources: EditorTarget[] = [{ ...source }];
  const saving = actionsFor(db, ['A', 'B']).handleAppendSources('A', sources);
  expect(db.mutate).toHaveBeenCalledOnce(); expect(append).not.toHaveBeenCalled();
  // A preceding editor save finishes while the source append is waiting in FIFO.
  db.confirmedEvents.current = [...events, {
    seq: 7, id: 'newer-editor-save', timestamp: now.toISOString(), undone: false,
    type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'A', description: 'Newer editor draft' },
  }];
  sources[0].value = 'https://example.com/changed-after-drop'; sources.push({ kind: 'url', value: 'https://example.com/extra' });
  finish(await queued()); await saving;
  expect(append).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledWith([
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'A', description: 'Newer editor draft\n\n<https://example.com/source>' } },
    { type: 'TASK_DESCRIPTION_SET', payload: { taskId: 'B', description: 'Description B\n\n<https://example.com/source>' } },
  ]);
});
