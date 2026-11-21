import { useCallback, useEffect, useReducer, useRef } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import { projectEvents } from '../domain/projector';
import { appendTaskSources } from '../domain/taskSources';
import { isMarkdownPath, readMarkdownSources, type DescriptionAddition } from '../components/editor/markdownImport';
import type { EditorTarget } from '../components/editor/types';
import type { TaskState } from '../domain/types';
import type { useDatabaseSnapshot } from './useDatabaseSnapshot';

interface Draft { database: string; taskId: string; text: string; revision: number }
type Database = Pick<ReturnType<typeof useDatabaseSnapshot>, 'databaseIdentity' | 'confirmedEvents' | 'mutate' | 'saves'>;

// A description edit is a local session, including formatting, paste and local undo.
// Each change immediately requests a durable SQLite checkpoint; only leaving
// the session adds undo history. Drafts live above the
// editor so a failed save survives task switches, collapse and mini mode. They
// are keyed by database as well as task; never carry a draft into another store.
export function useDescriptionDrafts(database: Database) {
  const current = useRef(database); current.current = database;
  const drafts = useRef(new Map<string, Draft>());
  const session = useRef(crypto.randomUUID());
  const revision = useRef(0);
  const protectedDrafts = useRef(new WeakSet<Draft>());
  const checkpointing = useRef(new Map<string, Promise<void>>());
  const failed = useRef(new Set<string>());
  const mounted = useRef(true);
  const saving = useRef(new Map<string, { draft: Draft; promise: Promise<boolean> }>());
  const [, redraw] = useReducer((revision: number) => revision + 1, 0);
  const keyFor = (taskId: string) => JSON.stringify([current.current.databaseIdentity.current, taskId]);
  // At most one checkpoint per task is queued. Continued typing replaces the
  // waiting value; after acknowledgement the newest value is sent immediately.
  // Use the mutation FIFO so a final save/database switch cannot overtake it.
  const checkpoint = useCallback(function checkpoint(key: string) {
    if (checkpointing.current.has(key) || saving.current.has(key)) return;
    const draft = drafts.current.get(key);
    if (!draft || protectedDrafts.current.has(draft)) return;
    const db = current.current;
    if (draft.database !== db.databaseIdentity.current) return;
    let written: Draft | undefined;
    const operation = (async () => {
      const result = await db.mutate(async () => {
        written = drafts.current.get(key);
        if (!written || protectedDrafts.current.has(written)) return db.confirmedEvents.current;
        const base = projectEvents(db.confirmedEvents.current).tasks[written.taskId]?.description;
        if (base === undefined) throw new Error('Unknown description task');
        await eventBridge.saveDescriptionDraft(written.database, written.taskId, written.text, base, session.current, written.revision);
        protectedDrafts.current.add(written);
        return db.confirmedEvents.current;
      });
      if (result) failed.current.delete(key); else failed.current.add(key);
      checkpointing.current.delete(key);
      if (mounted.current) {
        redraw();
        if (result && drafts.current.get(key) !== written) checkpoint(key);
      }
    })();
    checkpointing.current.set(key, operation);
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Retry failed/busy writes without requiring another keystroke or focus change.
    const retry = setInterval(() => { for (const key of drafts.current.keys()) checkpoint(key); }, 1000);
    return () => { mounted.current = false; clearInterval(retry); };
  }, [checkpoint]);
  const change = useCallback((taskId: string, text: string) => {
    const db = current.current.databaseIdentity.current;
    if (!db) return;
    const key = JSON.stringify([db, taskId]);
    drafts.current.set(key, { database: db, taskId, text, revision: ++revision.current });
    redraw();
    checkpoint(key);
  }, [checkpoint]);
  const persistDrafts = useCallback((entries: [string, Draft][], batch = false): Promise<boolean> => {
    if (!entries.length) return Promise.resolve(true);
    const db = current.current;
    if (entries.some(([, draft]) => draft.database !== db.databaseIdentity.current)) return Promise.resolve(false);
    const operation = (async () => {
      const result = await db.mutate(() => {
        const commands = entries.map(([, draft]) => ({ type: 'TASK_DESCRIPTION_SET' as const, payload: { taskId: draft.taskId, description: draft.text } }));
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
        return [key, { database: identity, taskId, revision: ++revision.current,
          text: appendTaskSources(drafts.current.get(key)?.text ?? tasks[taskId].description, additions) }];
      });
      // Publish sources into the local document BEFORE awaiting native persistence.
      // Further typing therefore includes them, even while this atomic group waits.
      for (const [key, draft] of entries) drafts.current.set(key, draft);
      if (entries.length) redraw();
      return persistDrafts(entries, true);
    };
    if (!sources.some(source => source.kind === 'path' && isMarkdownPath(source.value))) return append(sources);
    // Admission starts at the file read, before a draft or queued write exists.
    return db.saves.track(readMarkdownSources(sources).then(append), 'import');
  }, [persistDrafts]);
  const flush = useCallback((taskId: string) => flushKey(keyFor(taskId)), [flushKey]);
  const flushDrafts = useCallback(async () => {
    const identity = current.current.databaseIdentity.current;
    for (const [key, draft] of [...drafts.current]) {
      if (draft.database === identity && !await flushKey(key)) return false;
    }
    return identity === current.current.databaseIdentity.current;
  }, [flushKey]);
  const taskWithDraft = (task: TaskState | null): TaskState | null => {
    if (!task) return null;
    const draft = drafts.current.get(keyFor(task.id));
    return draft ? { ...task, description: draft.text } : task;
  };
  const protectionState = (taskId: string): 'saved' | 'saving' | 'error' => {
    const key = keyFor(taskId), draft = drafts.current.get(key);
    if (!draft || protectedDrafts.current.has(draft)) return 'saved';
    return failed.current.has(key) ? 'error' : 'saving';
  };
  return { protectionState, change, flush, flushDrafts, appendSources, taskWithDraft,
    hasPending: () => current.current.saves.hasImports() || checkpointing.current.size > 0 || saving.current.size > 0,
    hasDrafts: () => drafts.current.size > 0 };
}
