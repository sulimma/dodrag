import { useCallback, useReducer, useRef } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents } from '../domain/projector';
import { appendTaskSources } from '../domain/taskSources';
import { isMarkdownPath, readMarkdownSources, type DescriptionAddition } from '../components/editor/markdownImport';
import type { EditorTarget } from '../components/editor/types';
import type { TaskState } from '../domain/types';
import type { useDatabaseSnapshot } from './useDatabaseSnapshot';

interface Draft { database: string; taskId: string; text: string }
type Database = Pick<ReturnType<typeof useDatabaseSnapshot>, 'databaseIdentity' | 'confirmedEvents' | 'mutate' | 'waitForMutations'>;

// A description edit is a local session, including formatting, paste and local undo.
// Only leaving that session persists its final Markdown. Drafts live above the
// editor so a failed save survives task switches, collapse and mini mode. They
// are keyed by database as well as task; never carry a draft into another store.
export function useDescriptionDrafts(database: Database) {
  const current = useRef(database); current.current = database;
  const drafts = useRef(new Map<string, Draft>());
  const saving = useRef(new Map<string, { draft: Draft; promise: Promise<boolean> }>());
  const [, redraw] = useReducer((revision: number) => revision + 1, 0);
  const keyFor = (taskId: string) => JSON.stringify([current.current.databaseIdentity.current, taskId]);
  const change = useCallback((taskId: string, text: string) => {
    const db = current.current.databaseIdentity.current;
    if (!db) return;
    drafts.current.set(JSON.stringify([db, taskId]), { database: db, taskId, text });
    redraw();
  }, []);
  const persistDrafts = useCallback((entries: [string, Draft][], batch = false): Promise<boolean> => {
    if (!entries.length) return Promise.resolve(true);
    const db = current.current;
    if (entries.some(([, draft]) => draft.database !== db.databaseIdentity.current)) return Promise.resolve(false);
    const operation = (async () => {
      const result = await db.mutate(() => {
        const tasks = projectEvents(db.confirmedEvents.current).tasks;
        const commands = entries.filter(([, draft]) => tasks[draft.taskId]?.description !== draft.text)
          .map(([, draft]) => ({ type: 'TASK_DESCRIPTION_SET' as const, payload: { taskId: draft.taskId, description: draft.text } }));
        if (!commands.length) return Promise.resolve(db.confirmedEvents.current);
        return batch || commands.length > 1 ? eventBridge.appendBatch(commands)
          : eventBridge.appendEvent('TASK_DESCRIPTION_SET', commands[0].payload);
      });
      if (!result) return false;
      // A response confirms only its own immutable drafts, never newer typing.
      let changed = false;
      for (const [key, draft] of entries) if (drafts.current.get(key) === draft) { drafts.current.delete(key); changed = true; }
      if (changed) redraw();
      return true;
    })();
    for (const [key, draft] of entries) saving.current.set(key, { draft, promise: operation });
    void operation.finally(() => {
      for (const [key] of entries) if (saving.current.get(key)?.promise === operation) saving.current.delete(key);
    });
    return operation;
  }, []);
  const flushKey = useCallback((key: string): Promise<boolean> => {
    const draft = drafts.current.get(key);
    if (!draft) return Promise.resolve(true);
    const pending = saving.current.get(key);
    return pending?.draft === draft ? pending.promise : persistDrafts([[key, draft]]);
  }, [persistDrafts]);
  const appendSources = useCallback((taskIds: readonly string[], sources: readonly EditorTarget[]) => {
    if (!sources.length) return Promise.resolve(true);
    appendTaskSources('', sources); // Validate the complete group before changing any draft.
    const db = current.current, identity = db.databaseIdentity.current;
    const append = (additions: readonly DescriptionAddition[]) => {
      if (identity !== current.current.databaseIdentity.current) return Promise.resolve(false);
      const tasks = projectEvents(db.confirmedEvents.current).tasks;
      const entries: [string, Draft][] = [...new Set(taskIds)].filter(id => tasks[id]).map(taskId => {
        const key = JSON.stringify([identity, taskId]);
        return [key, { database: identity, taskId,
          text: appendTaskSources(drafts.current.get(key)?.text ?? tasks[taskId].description, additions) }];
      });
      // Publish sources into the local document BEFORE awaiting native persistence.
      // Further typing therefore includes them, even while this atomic group waits.
      for (const [key, draft] of entries) drafts.current.set(key, draft);
      if (entries.length) redraw();
      return persistDrafts(entries, true);
    };
    return sources.some(source => source.kind === 'path' && isMarkdownPath(source.value))
      ? readMarkdownSources(sources).then(append) : append(sources);
  }, [persistDrafts]);
  const flush = useCallback((taskId: string) => flushKey(keyFor(taskId)), [flushKey]);
  const flushAll = useCallback(async () => {
    const db = current.current;
    const identity = db.databaseIdentity.current;
    // A second boundary while a save is pending must also cover newer typing.
    for (;;) {
      const keys = [...drafts.current].filter(([, draft]) => draft.database === identity).map(([key]) => key);
      for (const key of keys) if (!await flushKey(key)) return false;
      await db.waitForMutations();
      if (identity !== db.databaseIdentity.current) return false;
      // Draining other mutations yields to React/input too. Recheck drafts
      // afterwards; a pre-drain empty map is not a completed final flush.
      if (![...drafts.current.values()].some(draft => draft.database === identity)) return true;
    }
  }, [flushKey]);
  const taskWithDraft = (task: TaskState | null): TaskState | null => {
    if (!task) return null;
    const draft = drafts.current.get(keyFor(task.id));
    return draft ? { ...task, description: draft.text } : task;
  };
  return { change, flush, flushAll, appendSources, taskWithDraft, hasPending: () => saving.current.size > 0, hasDrafts: () => drafts.current.size > 0 || saving.current.size > 0 };
}
