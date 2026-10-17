import {
  HighlightRole,
  ListEntry,
  ProjectedState,
  StoredEvent,
  TaskState,
} from './types';
import { calendarDistance, localDate } from './dates';
import { stableTopology } from './topology';
const weekdayFormatter = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
interface MutableTask {
  id: string; title: string; creationOrder: number; createdAt: string; configuredStart: string;
  predecessors: Set<string>; isActive: boolean; completed: boolean; completedAt?: string;
}
const replayCache = new WeakMap<StoredEvent[], { rawTasks: Record<string, MutableTask>; predecessorMap: Record<string, Set<string>> }>();

/**
 * Formats a Date into local YYYY-MM-DD key.
 */
export function toDateKey(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses a YYYY-MM-DD key into a local Date at 09:00:00.
 */
export function dateKeyToIsoStart(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = localDate(y, m || 1, d || 1);
  return dt.toISOString();
}

/**
 * Adds whole calendar days to an ISO timestamp while preserving time or defaulting to 09:00 local.
 */
export function addCalendarDays(isoString: string, days: number): string {
  const dt = new Date(isoString);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString();
}

/**
 * Checks whether a Date or YYYY-MM-DD string falls on a weekend (Saturday = 6, Sunday = 0).
 */
export function isWeekendDate(dateOrKey: Date | string): boolean {
  const dt =
    typeof dateOrKey === 'string'
      ? (() => {
          const [y, m, d] = dateOrKey.split('-').map(Number);
          return new Date(y, (m || 1) - 1, d || 1);
        })()
      : dateOrKey;
  const day = dt.getDay();
  return day === 0 || day === 6;
}

/**
 * Formats an ISO timestamp into ISO-8601 date (YYYY-MM-DD) or YYYY-MM-DD HH:mm, plus weekday & weekend flag.
 */
export function formatIso8601Display(isoString: string): {
  isoText: string;
  weekdayShort: string;
  isWeekend: boolean;
} {
  const dt = new Date(isoString);
  const datePart = toDateKey(dt);
  const hasCustomTime = dt.getHours() !== 9 || dt.getMinutes() !== 0 || dt.getSeconds() !== 0;
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const seconds = dt.getSeconds() ? `:${String(dt.getSeconds()).padStart(2,'0')}` : '';
  const isoText = hasCustomTime ? `${datePart} ${hh}:${mm}${seconds}` : datePart;
  const weekdayShort = weekdayFormatter
    .format(dt)
    .replace('.', '');
  const day = dt.getDay();
  return {
    isoText,
    weekdayShort,
    isWeekend: day === 0 || day === 6,
  };
}

/**
 * Computes ISO-8601 headings and weekend metadata for a YYYY-MM-DD date key relative to `now`.
 */
export function formatDateHeading(
  dateKey: string,
  now: Date
): {
  label: string;
  subLabel: string;
  isToday: boolean;
  isWeekend: boolean;
  weekdayShort: string;
} {
  const todayKey = toDateKey(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);
  const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const dayAfterKey = toDateKey(dayAfter);

  const [y, m, d] = dateKey.split('-').map(Number);
  const target = localDate(y, m || 1, d || 1, 0);
  const dayOfWeek = target.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const weekdayShort = weekdayFormatter
    .format(target)
    .replace('.', '');

  // Always show ISO-8601 (YYYY-MM-DD) prominently in label
  const isoLabel = `${dateKey} (${weekdayShort})`;

  if (dateKey === todayKey) {
    return {
      label: isoLabel,
      subLabel: 'Heute',
      isToday: true,
      isWeekend,
      weekdayShort,
    };
  }
  if (dateKey === tomorrowKey) {
    return {
      label: isoLabel,
      subLabel: 'Morgen',
      isToday: false,
      isWeekend,
      weekdayShort,
    };
  }
  if (dateKey === dayAfterKey) {
    return {
      label: isoLabel,
      subLabel: 'Übermorgen',
      isToday: false,
      isWeekend,
      weekdayShort,
    };
  }

  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetMidnight = target.getTime();
  const diffDays = Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

  const relative =
    diffDays > 0 ? `in ${diffDays} Tagen` : `vor ${Math.abs(diffDays)} Tagen`;

  return {
    label: isoLabel,
    subLabel: relative,
    isToday: false,
    isWeekend,
    weekdayShort,
  };
}

/**
 * Checks whether adding `candidatePredId` as a predecessor of `taskId` would create a cycle.
 * i.e. if `candidatePredId === taskId` or `taskId` is already an ancestor of `candidatePredId`.
 */
export function wouldCreateCycle(
  taskId: string,
  candidatePredId: string,
  predecessorMap: Record<string, Set<string>>
): boolean {
  if (taskId === candidatePredId) return true;

  const visited = new Set<string>();
  const queue: string[] = [candidatePredId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === taskId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);

    const preds = predecessorMap[curr];
    if (preds) {
      for (const p of preds) {
        if (!visited.has(p)) {
          queue.push(p);
        }
      }
    }
  }
  return false;
}

/**
 * Projects an ordered list of StoredEvents into the deterministic application state.
 */
export function projectEvents(
  events: StoredEvent[],
  now: Date = new Date()
): ProjectedState {
  const activeEvents = events.filter((e) => !e.undone);
  const canUndo = activeEvents.length > 0;
  const canRedo = events.some((e) => e.undone);

  const cached = replayCache.get(events);
  const rawTasks: Record<string, MutableTask> = cached?.rawTasks ?? Object.create(null);
  const predecessorMap: Record<string, Set<string>> = cached?.predecessorMap ?? Object.create(null);
  let creationCounter = 0;

  const currentYearTwoDigits = now.getFullYear() % 100;
  const yearPrefix = `${String(currentYearTwoDigits).padStart(2, '0')}-`;
  let maxNumberForYear = 100;

  for (const ev of cached ? [] : activeEvents) {
    const p = ev.payload || {};
    switch (ev.type) {
      case 'TASK_CREATED': {
        const taskId = String(p.taskId || '');
        if (!taskId) break;
        if (rawTasks[taskId]) throw new Error(`Duplicate task: ${taskId}`);
        if (taskId.startsWith(yearPrefix)) {
          const numPart = parseInt(taskId.slice(yearPrefix.length), 10);
          if (!isNaN(numPart) && numPart > maxNumberForYear) {
            maxNumberForYear = numPart;
          }
        }
        creationCounter += 1;
        const preds = new Set<string>();
        predecessorMap[taskId] = preds;
        rawTasks[taskId] = {
          id: taskId,
          title: String(p.title ?? 'Unbenannter Task'),
          creationOrder: creationCounter,
          createdAt: String(p.createdAt || ev.timestamp || now.toISOString()),
          configuredStart: String(p.configuredStart || now.toISOString()),
          predecessors: preds,
          isActive: false,
          completed: false,
        };
        break;
      }

      case 'TASK_RENAMED': {
        const t = rawTasks[String(p.taskId)];
        if (t && typeof p.title === 'string') {
          t.title = p.title;
        }
        break;
      }

      case 'TASK_START_DATE_SET': {
        const t = rawTasks[String(p.taskId)];
        if (t && typeof p.configuredStart === 'string') {
          t.configuredStart = p.configuredStart;
        }
        break;
      }

      case 'DEPENDENCY_ADDED': {
        const taskId = String(p.taskId);
        const predId = String(p.predecessorId);
        const t = rawTasks[taskId];
        const pred = rawTasks[predId];
        if (t && pred && !wouldCreateCycle(taskId, predId, predecessorMap)) {
          t.predecessors.add(predId);
        }
        break;
      }

      case 'DEPENDENCY_REMOVED': {
        const t = rawTasks[String(p.taskId)];
        if (t) {
          t.predecessors.delete(String(p.predecessorId));
        }
        break;
      }

      case 'TASK_ACTIVE_SET': {
        const t = rawTasks[String(p.taskId)];
        if (t) {
          t.isActive = Boolean(p.isActive);
        }
        break;
      }

      case 'TASK_COMPLETED': {
        const t = rawTasks[String(p.taskId)];
        if (t) {
          t.completed = true;
          t.completedAt = String(p.completedAt || ev.timestamp || now.toISOString());
          t.isActive = false;
        }
        break;
      }

      case 'TASK_REOPENED': {
        const t = rawTasks[String(p.taskId)];
        if (t) {
          t.completed = false;
          t.completedAt = undefined;
        }
        break;
      }
    }
  }

  if (!cached) replayCache.set(events,{rawTasks,predecessorMap});
  for (const id of Object.keys(rawTasks)) if (id.startsWith(yearPrefix)) {
    const number = Number(id.slice(yearPrefix.length));
    if (Number.isInteger(number)) maxNumberForYear = Math.max(maxNumberForYear, number);
  }

  // Build time-dependent presentation separately from the cached event replay.
  const openPredsMap: Record<string, string[]> = {};
  const openSuccsMap: Record<string, string[]> = {};

  const allTaskIds = Object.keys(rawTasks);
  for (const id of allTaskIds) {
    openPredsMap[id] = [];
    openSuccsMap[id] = [];
  }

  for (const id of allTaskIds) {
    const t = rawTasks[id];
    const sortedPreds = Array.from(t.predecessors).sort(
      (a, b) => (rawTasks[a]?.creationOrder ?? 0) - (rawTasks[b]?.creationOrder ?? 0)
    );
    for (const predId of sortedPreds) {
      const predTask = rawTasks[predId];
      if (predTask && !predTask.completed) {
        openPredsMap[id].push(predId);
        if (!t.completed) {
          openSuccsMap[predId].push(id);
        }
      }
    }
  }

  // Calculate once in topological order, without recursion.
  const calculatedStartCache: Record<string, string | null> = Object.create(null);
  const effectiveStartCache: Record<string, string> = Object.create(null);
  const orderedRawTasks = stableTopology(allTaskIds.map(id => ({ ...rawTasks[id], predecessorIds: openPredsMap[id] })));
  for (const raw of orderedRawTasks) {
    let latest: string | null = null;
    for (const pred of openPredsMap[raw.id]) { const value = effectiveStartCache[pred]; if (!latest || Date.parse(value) > Date.parse(latest)) latest = value; }
    const calculated = latest ? addCalendarDays(latest,1) : null;
    calculatedStartCache[raw.id] = calculated;
    effectiveStartCache[raw.id] = calculated && Date.parse(calculated) > Date.parse(raw.configuredStart) ? calculated : raw.configuredStart;
  }

  function computeDates(taskId: string): { calculated: string | null; effective: string } {
    return { calculated: calculatedStartCache[taskId], effective: effectiveStartCache[taskId] };
  }

  const tasks: Record<string, TaskState> = {};
  const openTasks: TaskState[] = [];
  const completedTasks: TaskState[] = [];

  const todayKey = toDateKey(now);
  const nowMs = now.getTime();

  // "Wenn es keinen Task heute gibt, werden die Task im ersten nicht-leeren Tag so dargestellt wie sonst die Tasks heute."
  let firstNonEmptyDateKey = todayKey;
  const openEffectiveDateKeys: string[] = [];
  for (const id of allTaskIds) {
    const raw = rawTasks[id];
    if (raw.completed) continue;
    const { effective } = computeDates(id);
    const rawKey = toDateKey(new Date(effective));
    openEffectiveDateKeys.push(rawKey < todayKey ? todayKey : rawKey);
  }
  if (openEffectiveDateKeys.length > 0) {
    openEffectiveDateKeys.sort();
    firstNonEmptyDateKey = openEffectiveDateKeys[0];
  }

  for (const id of allTaskIds) {
    const raw = rawTasks[id];
    const { calculated, effective } = computeDates(id);
    const openPreds = openPredsMap[id] || [];
    const allPreds = Array.from(raw.predecessors);
    const openSuccs = openSuccsMap[id] || [];

    const effectiveDate = new Date(effective);
    const rawDateKey = toDateKey(effectiveDate);
    // Past start dates are grouped under Today ("Heute") so actionable tasks appear under Today
    const effectiveDateKey = rawDateKey < todayKey ? todayKey : rawDateKey;

    const isFutureStart =
      effectiveDateKey > firstNonEmptyDateKey ||
      (effectiveDateKey === todayKey && effectiveDate.getTime() > nowMs + 60_000);
    const hasOpenPredecessors = openPreds.length > 0;

    // Only tasks without open predecessors can remain active
    const effectiveIsActive = raw.isActive && !hasOpenPredecessors && !raw.completed;

    const taskState: TaskState = {
      id: raw.id,
      title: raw.title,
      creationOrder: raw.creationOrder,
      createdAt: raw.createdAt,
      configuredStart: raw.configuredStart,
      calculatedStart: calculated,
      effectiveStart: effective,
      effectiveDateKey,
      predecessorIds: openPreds,
      allPredecessorIds: allPreds,
      successorIds: openSuccs,
      isActive: effectiveIsActive,
      completed: raw.completed,
      completedAt: raw.completedAt,
      isDeemphasized: isFutureStart || hasOpenPredecessors,
    };

    tasks[id] = taskState;
    if (taskState.completed) {
      completedTasks.push(taskState);
    } else {
      openTasks.push(taskState);
    }
  }

  // Newest tasks appear at the top (highest creationOrder first)
  openTasks.splice(0,openTasks.length,...stableTopology(openTasks));
  completedTasks.sort((a, b) => {
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bTime - aTime;
  });

  const listEntries = buildTopologicallySortedAndCollapsedList(openTasks, now);
  const nextTaskId = `${yearPrefix}${maxNumberForYear + 1}`;

  return {
    tasks,
    openTasks,
    completedTasks,
    listEntries,
    canUndo,
    canRedo,
    activeEventCount: activeEvents.length,
    totalEventCount: events.length,
    nextTaskId,
  };
}

/**
 * Builds the topologically sorted list of Date entries and Task entries,
 * preserving relative order of unaffected tasks (stable Kahn's algorithm, newest tasks first),
 * always keeping Today ("Heute") visible at the top so tasks can be dragged onto Today,
 * and collapsing other consecutive empty date entries so only the latest date entry is shown.
 */
function buildTopologicallySortedAndCollapsedList(
  openTasks: TaskState[],
  now: Date
): ListEntry[] {
  const todayKey = toDateKey(now);

  // Collect all relevant date keys from Today up to the latest task date
  const dateKeySet = new Set<string>([todayKey]);
  let maxDateKey = todayKey;

  for (const t of openTasks) {
    if (t.effectiveDateKey >= todayKey) {
      dateKeySet.add(t.effectiveDateKey);
      if (t.effectiveDateKey > maxDateKey) maxDateKey = t.effectiveDateKey;
    }
    const confKey = toDateKey(new Date(t.configuredStart));
    if (confKey >= todayKey) {
      dateKeySet.add(confKey);
      if (confKey > maxDateKey) maxDateKey = confKey;
    }
  }

  // Only relevant headings are materialized; skipped calendar spans are counted arithmetically.

  const sortedDateKeys = Array.from(dateKeySet).sort();

  // Group tasks by their effectiveDateKey
  const tasksByDate: Record<string, TaskState[]> = {};
  for (const dk of sortedDateKeys) {
    tasksByDate[dk] = [];
  }
  for (const t of openTasks) {
    const dk = t.effectiveDateKey < todayKey ? todayKey : t.effectiveDateKey;
    if (!tasksByDate[dk]) {
      tasksByDate[dk] = [];
    }
    tasksByDate[dk].push(t);
  }

  // Within each date bucket, perform a STABLE topological sort using Kahn's algorithm
  // with descending creationOrder (newest tasks at the very top) as deterministic tie-breaker.
  const rawEntries: ListEntry[] = [];

  for (const dk of sortedDateKeys) {
    const { label, subLabel, isToday, isWeekend, weekdayShort } = formatDateHeading(
      dk,
      now
    );
    rawEntries.push({
      kind: 'date',
      key: `date:${dk}`,
      dateKey: dk,
      isoDate: dateKeyToIsoStart(dk),
      label,
      subLabel,
      collapsedCount: 0,
      isToday,
      isWeekend,
      weekdayShort,
    });

    const bucketTasks = tasksByDate[dk] || [];
    for (const task of stableTopology(bucketTasks)) rawEntries.push({ kind: 'task', key: `task:${task.id}`, task });
  }

  // Collapse rule:
  // 1. "Heute wird immer als Datum angezeigt, damit man tasks auf heute schieben kann."
  // 2. "Wenn mehrere Datumseinträge unmittelbar hintereinander folgen, wird nur der späteste angezeigt."
  const collapsedEntries: ListEntry[] = [];
  let i = 0;
  while (i < rawEntries.length) {
    const current = rawEntries[i];
    if (current.kind === 'date') {
      if (current.isToday) {
        collapsedEntries.push(current);
        i += 1;
        continue;
      }

      let j = i;
      while (j + 1 < rawEntries.length && rawEntries[j + 1].kind === 'date') {
        j += 1;
      }
      const latestDateEntry = rawEntries[j] as Extract<ListEntry, { kind: 'date' }>;
      const firstDateEntry = rawEntries[i] as Extract<ListEntry, { kind: 'date' }>;
      const collapsedCount = j - i;

      collapsedEntries.push({
        ...latestDateEntry,
        collapsedCount,
        collapsedFromDateKey: collapsedCount > 0 ? firstDateEntry.dateKey : undefined,
        isToday: latestDateEntry.isToday,
      });
      i = j + 1;
    } else {
      collapsedEntries.push(current);
      i += 1;
    }
  }

  let previousDate = todayKey;
  for (const entry of collapsedEntries) if (entry.kind === 'date' && !entry.isToday) {
    entry.collapsedCount = Math.max(0,calendarDistance(previousDate,entry.dateKey)-1);
    entry.collapsedFromDateKey = entry.collapsedCount ? toDateKey(new Date(addCalendarDays(dateKeyToIsoStart(previousDate),1))) : undefined;
    previousDate = entry.dateKey;
  }
  return collapsedEntries;
}

/**
 * Computes transitive reduction of the dependency graph for open tasks.
 * If A -> B, B -> C, and A -> C all exist in the database, the redundant edge A -> C is omitted.
 * Returns array of reduced edges `{ from: predecessorId, to: taskId }`.
 */
export function computeTransitiveReductionEdges(
  openTasks: TaskState[]
): Array<{ from: string; to: string }> {
  const taskMap: Record<string, TaskState> = {};
  for (const t of openTasks) {
    taskMap[t.id] = t;
  }

  const reducedEdges: Array<{ from: string; to: string }> = [];
  for (const task of openTasks) {
    if (task.predecessorIds.length < 2) {
      for (const pred of task.predecessorIds) if (taskMap[pred]) reducedEdges.push({from:pred,to:task.id});
      continue;
    }
    // One shared traversal of all predecessor ancestors per fan-in, not pairwise BFS.
    const redundant = new Set<string>();
    const stack = task.predecessorIds.flatMap(id => taskMap[id]?.predecessorIds ?? []);
    while (stack.length) {
      const id = stack.pop()!;
      if (redundant.has(id)) continue;
      redundant.add(id); stack.push(...(taskMap[id]?.predecessorIds ?? []));
    }
    for (const predId of task.predecessorIds) {
      if (!taskMap[predId]) continue;
      if (!redundant.has(predId)) {
        reducedEdges.push({ from: predId, to: task.id });
      }
    }
  }

  return reducedEdges;
}

/**
 * Computes transitive predecessors and transitive successors for the selected task.
 * Returns a map from taskId -> HighlightRole.
 */
export function computeDependencyHighlights(
  selectedTaskId: string | null,
  tasks: Record<string, TaskState>
): Record<string, HighlightRole> {
  const result: Record<string, HighlightRole> = {};
  if (!selectedTaskId || !tasks[selectedTaskId]) {
    return result;
  }

  result[selectedTaskId] = 'selected';

  // Traverse all predecessors (direct & transitive)
  const predQueue: Array<{ id: string; depth: number }> = [];
  for (const pId of tasks[selectedTaskId].predecessorIds) {
    predQueue.push({ id: pId, depth: 1 });
  }
  const visitedPreds = new Set<string>();
  while (predQueue.length > 0) {
    const { id, depth } = predQueue.shift()!;
    if (visitedPreds.has(id)) continue;
    visitedPreds.add(id);

    result[id] = depth === 1 ? 'predecessor-direct' : 'predecessor-transitive';
    const node = tasks[id];
    if (node) {
      for (const nextPred of node.predecessorIds) {
        if (!visitedPreds.has(nextPred)) {
          predQueue.push({ id: nextPred, depth: depth + 1 });
        }
      }
    }
  }

  // Traverse all successors (direct & transitive)
  const succQueue: Array<{ id: string; depth: number }> = [];
  for (const sId of tasks[selectedTaskId].successorIds) {
    succQueue.push({ id: sId, depth: 1 });
  }
  const visitedSuccs = new Set<string>();
  while (succQueue.length > 0) {
    const { id, depth } = succQueue.shift()!;
    if (visitedSuccs.has(id)) continue;
    visitedSuccs.add(id);

    result[id] = depth === 1 ? 'successor-direct' : 'successor-transitive';
    const node = tasks[id];
    if (node) {
      for (const nextSucc of node.successorIds) {
        if (!visitedSuccs.has(nextSucc)) {
          succQueue.push({ id: nextSucc, depth: depth + 1 });
        }
      }
    }
  }

  return result;
}

/**
 * Calculates target start timestamp for the sidebar quick-resubmission drag targets.
 */
export type QuickResubmitTargetId =
  | 'plus_2h'
  | 'plus_1d'
  | 'next_week'
  | 'plus_7d'
  | 'next_month';

export function calculateQuickResubmitDate(
  targetId: QuickResubmitTargetId,
  task: Pick<TaskState, 'effectiveStart' | 'effectiveDateKey'>
): string {
  const effective = new Date(task.effectiveStart);
  const [year, month, day] = task.effectiveDateKey.split('-').map(Number);
  // Use the visible day (overdue tasks appear under Today), retaining the effective time.
  const now = localDate(year, month, day, effective.getHours(), effective.getMinutes(), effective.getSeconds());
  switch (targetId) {
    case 'plus_2h': {
      return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    }
    case 'plus_1d': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
      return d.toISOString();
    }
    case 'next_week': {
      // Next Monday at 09:00
      const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ...
      const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysUntilNextMonday,
        9,
        0,
        0,
        0
      );
      return d.toISOString();
    }
    case 'plus_7d': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0, 0, 0);
      return d.toISOString();
    }
    case 'next_month': {
      // First day of next month at 09:00
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

/**
 * Returns the tasks to display in the compact corner-docked minimized window:
 * - Only tasks that can currently be worked on (no open predecessors: predecessorIds.length === 0).
 * - Specifically: tasks from Today without predecessors; if there are none on Today, all open tasks without predecessors.
 * - Active tasks (isActive) are sorted to the top, followed by effectiveDateKey ascending and newest creationOrder first.
 */
export function computeMiniWindowTasks(
  openTasks: TaskState[],
  now: Date = new Date()
): TaskState[] {
  const todayKey = toDateKey(now);
  const withoutPreds = openTasks.filter(
    (t) => !t.completed && t.predecessorIds.length === 0
  );

  const todayStartable = withoutPreds.filter(
    (t) => t.effectiveDateKey <= todayKey
  );

  const pool = todayStartable.length > 0 ? todayStartable : withoutPreds;

  return [...pool].sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1;
    }
    if (a.effectiveDateKey !== b.effectiveDateKey) {
      return a.effectiveDateKey.localeCompare(b.effectiveDateKey);
    }
    return b.creationOrder - a.creationOrder;
  });
}
