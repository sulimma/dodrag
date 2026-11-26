import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { eventBridge } from '../../bridge/eventBridge';
import type { StoredEvent } from '../../domain/types';
import type { useDatabaseSnapshot } from '../../hooks/useDatabaseSnapshot';
import type { PushToast } from '../../hooks/useToasts';
import { errorText, t } from '../../i18n';
import { timeMeasurementPluginId, type TimeMeasurementSession, type TimeMeasurementState } from './types';

type Database = ReturnType<typeof useDatabaseSnapshot>;

type Scope = {
  generation: number;
  queue: Promise<unknown>;
  writing: boolean;
};

interface View {
  scope: Scope;
  state?: TimeMeasurementState;
  loadError?: string;
  pending: boolean;
  announcement?: string;
}

export function taskCreationIds(events: StoredEvent[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const event of events) {
    if (!event.undone && event.type === 'TASK_CREATED') ids.set(event.payload.taskId, event.id);
  }
  return ids;
}

export function useTimeMeasurement(database: Database, pushToast: PushToast) {
  const generation = database.snapshotReady && database.appSettings?.pluginEnabled?.[timeMeasurementPluginId]
    ? database.appSettings.databaseGeneration : undefined;
  const scope = useMemo<Scope | null>(() => generation ? { generation, queue: Promise.resolve(), writing: false } : null, [generation]);
  const activeScope = useRef<Scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);

  const [view, setView] = useState<View | null>(null);
  const current = view?.scope === scope ? view : null;
  const ids = useMemo(() => generation ? taskCreationIds(database.events) : new Map<string, string>(), [generation, database.events]);
  const sessions = current?.state?.sessions;
  const savedTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of sessions ?? []) {
      if (ids.get(session.taskId) !== session.taskCreationEventId || session.endMs === null || session.elapsedMs === null) continue;
      totals.set(session.taskId, (totals.get(session.taskId) ?? 0) + session.elapsedMs);
    }
    return totals;
  }, [sessions, ids]);
  const isCurrent = (target: Scope) => activeScope.current === target && database.snapshotConfirmed.current &&
    database.confirmedSettings.current?.databaseGeneration === target.generation &&
    database.confirmedSettings.current.pluginEnabled?.[timeMeasurementPluginId] === true;
  const publish = (target: Scope, values: Partial<Omit<View, 'scope'>>) => {
    if (isCurrent(target)) setView(previous => ({ pending: false, ...(previous?.scope === target ? previous : {}), ...values, scope: target }));
  };

  // Read and write replies share a queue. A read sent before a write cannot
  // overwrite its result, and the native generation guards delayed dispatch.
  const refresh = () => {
    if (!scope || !isCurrent(scope)) return;
    scope.queue = scope.queue.then(async () => {
      if (!isCurrent(scope)) return;
      try {
        const state = await eventBridge.getTimeMeasurement(scope.generation);
        publish(scope, { state, loadError: undefined });
      } catch (error) {
        publish(scope, { loadError: errorText(t('Zeiterfassung konnte nicht geladen werden'), error) });
      }
    });
  };
  useEffect(refresh, [scope, database.snapshotRevision]);

  const write = async (
    operation: (generation: number) => Promise<TimeMeasurementState>,
    announce: (state: TimeMeasurementState) => string,
    showDiscard = false,
  ): Promise<boolean> => {
    if (!scope || !current?.state || scope.writing || !isCurrent(scope) || document.body.inert) return false;
    scope.writing = true;
    publish(scope, { pending: true, announcement: undefined });
    const result = database.saves.track(scope.queue.then(async () => {
      if (!isCurrent(scope)) throw new Error(t('Datenbank wurde gewechselt'));
      return operation(scope.generation);
    }), 'write');
    scope.queue = result.catch(() => {});
    try {
      const state = await result;
      if (!isCurrent(scope)) return false;
      const discarded = showDiscard && state.discarded;
      const message = discarded ? t('Messung unter 30 Sekunden wurde verworfen.') : announce(state);
      publish(scope, { state, loadError: undefined, announcement: message });
      if (discarded) pushToast(message, 'info');
      return true;
    } catch (error) {
      if (isCurrent(scope)) {
        const message = errorText(t('Aktion fehlgeschlagen'), error);
        publish(scope, { announcement: message });
        pushToast(message, 'warning');
      }
      return false;
    } finally {
      scope.writing = false;
      publish(scope, { pending: false });
    }
  };

  return {
    enabled: Boolean(scope),
    generation,
    state: current?.state,
    pending: current?.pending ?? false,
    loadError: current?.loadError,
    announcement: current?.announcement,
    refresh,
    creationId: (taskId: string) => ids.get(taskId),
    savedTotal: (taskId: string) => savedTotals.get(taskId) ?? 0,
    start: (taskId: string, creationId: string) => write(gen => eventBridge.startTimeMeasurement(gen, taskId, creationId), () => t('Messung wurde gestartet')),
    stop: ({ id }: TimeMeasurementSession) => write(gen => eventBridge.stopTimeMeasurement(gen, id), () => t('Messung wurde gestoppt'), true),
    edit: ({ id }: TimeMeasurementSession, endMs: number) => write(gen => eventBridge.updateTimeMeasurementEnd(gen, id, endMs), () => t('Sitzung wurde aktualisiert')),
    remove: ({ id }: TimeMeasurementSession) => write(gen => eventBridge.deleteTimeMeasurementSession(gen, id), () => t('Sitzung wurde gelöscht')),
    recover: ({ id }: TimeMeasurementSession, endMs: number | null) => write(
      gen => eventBridge.recoverTimeMeasurement(gen, id, endMs ?? 0, endMs === null),
      () => endMs === null ? t('Unterbrochene Messung wurde verworfen') : t('Sitzung wurde aktualisiert'), endMs !== null,
    ),
  };
}

export type TimeMeasurement = ReturnType<typeof useTimeMeasurement>;
