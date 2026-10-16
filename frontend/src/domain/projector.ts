import {
  HighlightRole,
  ListEntry,
  ProjectedState,
  StoredEvent,
  TaskState,
} from './types';

/**
 * Formats a Date into local YYYY-MM-DD key.
 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses a YYYY-MM-DD key into a local Date at 09:00:00.
 */
export function dateKeyToIsoStart(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, 9, 0, 0, 0);
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
  const hasCustomTime = dt.getHours() !== 9 || dt.getMinutes() !== 0;
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const isoText = hasCustomTime ? `${datePart} ${hh}:${mm}` : datePart;
  const weekdayShort = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
  })
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
  const target = new Date(y, (m || 1) - 1, d || 1);
  const dayOfWeek = target.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const weekdayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short' })
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

  interface MutableTask {
    id: string;
    title: string;
    creationOrder: number;
    createdAt: string;
    configuredStart: string;
    predecessors: Set<string>;
    isActive: boolean;
    completed: boolean;
    completedAt?: string;
  }

  const rawTasks: Record<string, MutableTask> = {};
  const predecessorMap: Record<string, Set<string>> = {};
  let creationCounter = 0;

  const currentYearTwoDigits = now.getFullYear() % 100;
  const yearPrefix = `${String(currentYearTwoDigits).padStart(2, '0')}-`;
  let maxNumberForYear = 100;

  for (const ev of activeEvents) {
    const p = ev.payload || {};
    switch (ev.type) {
      case 'TASK_CREATED': {
        const taskId = String(p.taskId || '');
        if (!taskId) break;
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

  // Build open predecessor & successor adjacency for open tasks
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

  // Memoized recursive calculation of calculatedStart and effectiveStart across the DAG
  const calculatedStartCache: Record<string, string | null> = {};
  const effectiveStartCache: Record<string, string> = {};
  const visiting = new Set<string>();

  function computeDates(taskId: string): { calculated: string | null; effective: string } {
    if (effectiveStartCache[taskId] !== undefined) {
      return {
        calculated: calculatedStartCache[taskId],
        effective: effectiveStartCache[taskId],
      };
    }

    const t = rawTasks[taskId];
    if (!t) {
      const fallback = now.toISOString();
      return { calculated: null, effective: fallback };
    }

    if (visiting.has(taskId)) {
      // Safety guard against unexpected cycles
      return { calculated: null, effective: t.configuredStart };
    }
    visiting.add(taskId);

    const openPreds = openPredsMap[taskId] || [];
    let latestPredEffectiveMs: number | null = null;
    let latestPredEffectiveIso: string | null = null;

    for (const predId of openPreds) {
      const predDates = computeDates(predId);
      const ms = new Date(predDates.effective).getTime();
      if (latestPredEffectiveMs === null || ms > latestPredEffectiveMs) {
        latestPredEffectiveMs = ms;
        latestPredEffectiveIso = predDates.effective;
      }
    }

    visiting.delete(taskId);

    // "Letzteres liegt einen Tag nach dem spätesten startdatum eines vorgängers."
    const calculatedIso = latestPredEffectiveIso
      ? addCalendarDays(latestPredEffectiveIso, 1)
      : null;

    const configuredMs = new Date(t.configuredStart).getTime();
    const calculatedMs = calculatedIso ? new Date(calculatedIso).getTime() : -Infinity;

    const effectiveIso =
      calculatedIso && calculatedMs > configuredMs ? calculatedIso : t.configuredStart;

    calculatedStartCache[taskId] = calculatedIso;
    effectiveStartCache[taskId] = effectiveIso;

    return { calculated: calculatedIso, effective: effectiveIso };
  }

  const tasks: Record<string, TaskState> = {};
  const openTasks: TaskState[] = [];
  const completedTasks: TaskState[] = [];

  const todayKey = toDateKey(now);
  const nowMs = now.getTime();

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

    const isFutureStart = effectiveDateKey > todayKey || effectiveDate.getTime() > nowMs + 60_000;
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
      isWaitingOrFuture: isFutureStart || hasOpenPredecessors,
    };

    tasks[id] = taskState;
    if (taskState.completed) {
      completedTasks.push(taskState);
    } else {
      openTasks.push(taskState);
    }
  }

  openTasks.sort((a, b) => a.creationOrder - b.creationOrder);
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
 * preserving relative order of unaffected tasks (stable Kahn's algorithm)
 * and collapsing consecutive date entries so only the latest date entry is shown.
 */
function buildTopologicallySortedAndCollapsedList(
  openTasks: TaskState[],
  now: Date
): ListEntry[] {
  const todayKey = toDateKey(now);

  // Collect all relevant date keys:
  // 1. Today
  // 2. Next 3 upcoming calendar days (so we also demonstrate consecutive empty date collapsing & drop targets)
  // 3. Every open task's effectiveDateKey and configuredStart dateKey
  const dateKeySet = new Set<string>([todayKey]);

  for (let offset = 1; offset <= 3; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    dateKeySet.add(toDateKey(d));
  }

  for (const t of openTasks) {
    if (t.effectiveDateKey >= todayKey) {
      dateKeySet.add(t.effectiveDateKey);
    }
    const confKey = toDateKey(new Date(t.configuredStart));
    if (confKey >= todayKey) {
      dateKeySet.add(confKey);
    }
  }

  const sortedDateKeys = Array.from(dateKeySet).sort();

  // Group tasks by their effectiveDateKey
  // Because each predecessor P has effectiveStart(P) < calculatedStart(T) <= effectiveStart(T),
  // effectiveDateKey(P) <= effectiveDateKey(T) is mathematically guaranteed!
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
  // with creationOrder as deterministic tie-breaker so unaffected tasks never change order.
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
    if (bucketTasks.length === 0) continue;

    const bucketIds = new Set(bucketTasks.map((t) => t.id));
    const inDegree: Record<string, number> = {};
    const dependents: Record<string, string[]> = {};

    for (const t of bucketTasks) {
      inDegree[t.id] = 0;
      dependents[t.id] = [];
    }

    for (const t of bucketTasks) {
      for (const predId of t.predecessorIds) {
        if (bucketIds.has(predId)) {
          inDegree[t.id] += 1;
          dependents[predId].push(t.id);
        }
      }
    }

    const ready: TaskState[] = bucketTasks.filter((t) => inDegree[t.id] === 0);
    // Stable priority queue ordered by creationOrder
    ready.sort((a, b) => a.creationOrder - b.creationOrder);

    const taskMap: Record<string, TaskState> = {};
    for (const t of bucketTasks) taskMap[t.id] = t;

    while (ready.length > 0) {
      const current = ready.shift()!;
      rawEntries.push({
        kind: 'task',
        key: `task:${current.id}`,
        task: current,
      });

      for (const depId of dependents[current.id]) {
        inDegree[depId] -= 1;
        if (inDegree[depId] === 0) {
          ready.push(taskMap[depId]);
          ready.sort((a, b) => a.creationOrder - b.creationOrder);
        }
      }
    }
  }

  // Collapse rule:
  // "Wenn mehrere Datumseinträge unmittelbar hintereinander folgen, wird nur der späteste angezeigt."
  const collapsedEntries: ListEntry[] = [];
  let i = 0;
  while (i < rawEntries.length) {
    const current = rawEntries[i];
    if (current.kind === 'date') {
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
        isToday: latestDateEntry.isToday || firstDateEntry.isToday,
      });
      i = j + 1;
    } else {
      collapsedEntries.push(current);
      i += 1;
    }
  }

  return collapsedEntries;
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
  now: Date = new Date()
): string {
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
