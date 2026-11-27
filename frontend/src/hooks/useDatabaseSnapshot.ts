import { reportError } from '../diagnostics';
import { createSaveCompletion } from './saveCompletion';
import { useRef, useState } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import type { AppSettings } from '../bridge/eventBridge';
import type { StoredEvent } from '../domain/types';
import type { PushToast } from './useToasts';
import type { DragIdentity } from './useTaskDrag';
import { t, errorText } from '../i18n';
// Loads confirmed event snapshots and serializes mutations/database changes.
export function useDatabaseSnapshot(
  pushToast: PushToast,
  dragIdentity: React.MutableRefObject<DragIdentity | null>,
  onInvalidate: () => void,
  beforeChange?: () => Promise<boolean>,
  canAwaitBeforeChange?: () => boolean
) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const confirmedSettings = useRef<AppSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const refreshSnapshotDependents = () => setSnapshotRevision(revision => revision + 1);
  const pendingSettings = useRef<{ startup: boolean } | null>(null);
  const confirmSettings = (settings: AppSettings) => {
    confirmedSettings.current = settings;
    setAppSettings(settings);
  };
  // All settings snapshot operations share one gate. Only a replacement startup
  // can bypass it: the obsolete startup checks its lifecycle before publishing.
  const runSettings = async <T,>(operation: () => Promise<T>, startup = false): Promise<T> => {
    if (pendingSettings.current && !(startup && pendingSettings.current.startup))
      throw new Error(t('Eine Aenderung wird noch gespeichert'));
    const request = { startup };
    pendingSettings.current = request;
    setSettingsBusy(true);
    try { return await operation(); }
    finally {
      if (pendingSettings.current === request) {
        pendingSettings.current = null;
        setSettingsBusy(false);
      }
    }
  };
  const savePreference = (operation: () => Promise<AppSettings>) => runSettings(async () => {
    confirmSettings(await operation());
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [saves] = useState(createSaveCompletion);
  const mutationBusy = useRef(false);
  const snapshotConfirmed = useRef(false);
  const confirmedEvents = useRef<StoredEvent[]>([]);
  const databaseIdentity = useRef('');
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const queuedMutations = useRef(0);
  const changingDatabase = useRef(false);
  const waitForMutations = async () => {
    let observed: Promise<unknown>;
    do { observed = mutationQueue.current; await observed; } while (observed !== mutationQueue.current);
  };
  // Refs gate asynchronous writes immediately; render state only controls the UI.
  const runMutation = async (
    operation: () => Promise<StoredEvent[]>
  ): Promise<StoredEvent[] | null> => {
    if (!snapshotConfirmed.current || (mutationBusy.current && !queuedMutations.current)) return null;
    queuedMutations.current++;
    mutationBusy.current = true;
    const database = databaseIdentity.current;
    const previous = mutationQueue.current;
    let release!: () => void;
    mutationQueue.current = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (database !== databaseIdentity.current || !snapshotConfirmed.current)
        throw new Error(t('Datenbank wurde gewechselt'));
      const updated = await operation();
      if (database !== databaseIdentity.current)
        throw new Error(t('Datenbank wurde gewechselt'));
      confirmedEvents.current = updated;
      setEvents(updated);
      return updated;
    } catch (error) {
      reportError('task mutation', error);
      pushToast(errorText(t('Änderung konnte nicht gespeichert werden'), error), 'warning');
      return null;
    } finally {
      if (confirmedSettings.current?.databaseGeneration) refreshSnapshotDependents();
      queuedMutations.current--;
      mutationBusy.current = queuedMutations.current > 0;
      release();
    }
  };
  const mutate = (operation: () => Promise<StoredEvent[]>) => saves.track(runMutation(operation), 'write');
  const invalidateSnapshot = () => {
    snapshotConfirmed.current = false;
    setSnapshotReady(false);
    databaseIdentity.current = '';
    confirmedEvents.current = [];
    setEvents([]);
    onInvalidate();
  };
  const readSnapshot = async (isCurrent = () => true) => {
    const settings = await eventBridge.getSettings();
    if (!isCurrent()) return settings;
    confirmSettings(settings);
    if (!settings.databaseReady) {
      setShowSettingsModal(true);
      return settings;
    }
    const updated = await eventBridge.getEvents();
    if (!isCurrent()) return settings;
    databaseIdentity.current = settings.activeDatabasePath;
    confirmedEvents.current = updated;
    setEvents(updated);
    snapshotConfirmed.current = true;
    setSnapshotReady(true);
    refreshSnapshotDependents();
    return settings;
  };
  const loadSnapshot = (isCurrent = () => true) => runSettings(() => readSnapshot(isCurrent), true);
  const handleCloseSettingsModal = () => {
    if (pendingSettings.current || mutationBusy.current || !snapshotConfirmed.current) return;
    setShowSettingsModal(false);
  };

  const changeDatabase = (operation: () => Promise<AppSettings>) => runSettings(async () => {
    if (dragIdentity.current)
      throw new Error(t('Datenbankwechsel erst nach Ende des Ziehens'));
    if (changingDatabase.current || (mutationBusy.current && !canAwaitBeforeChange?.()))
      throw new Error(t('Eine Aenderung wird noch gespeichert'));
    changingDatabase.current = true;
    try {
      // Keep the old identity/drafts until their final save succeeds. The flush
      // may already be queued by blur; await it before testing the busy gate.
      if (beforeChange && !await beforeChange()) throw new Error(t('Beschreibung konnte nicht gespeichert werden'));
      if (mutationBusy.current) throw new Error(t('Eine Aenderung wird noch gespeichert'));
      mutationBusy.current = true;
      invalidateSnapshot();
      let operationError: unknown;
      try {
        await operation();
      } catch (error) {
        operationError = error;
      }
      // Read the actual backend identity after both success and partial failure.
      let settings: AppSettings;
      try {
        settings = await readSnapshot();
      } catch (error) {
        if (operationError !== undefined)
          throw new Error(`${String(operationError)}; ${String(error)}`);
        throw error;
      }
      if (operationError !== undefined) throw operationError;
      return settings;
    } catch (error) {
      setShowSettingsModal(true);
      pushToast(errorText(t('Datenbankwechsel fehlgeschlagen'), error), 'warning');
      throw error;
    } finally {
      changingDatabase.current = false;
      mutationBusy.current = queuedMutations.current > 0;
    }
  });

  const handleCreateDatabase = async (
    folderPath: string,
    dbName: string,
    seedDemo: boolean
  ) => {
    await changeDatabase(() =>
      eventBridge.createDatabase(folderPath, dbName, seedDemo)
    );
    pushToast(t('Datenbank „{name}“ angelegt und aktiviert', { name: dbName }), 'success');
  };

  const handleOpenExistingDatabase = async () => {
    const prevPath = appSettings?.activeDatabasePath;
    const updatedSettings = await changeDatabase(() =>
      eventBridge.openExistingDatabaseDialog()
    );
    if (updatedSettings.activeDatabasePath !== prevPath) {
      pushToast(t('Datenbank geöffnet und aktiviert'), 'success');
    }
  };

  const handleSwitchDatabase = async (dbPath: string) => {
    const updatedSettings = await changeDatabase(() =>
      eventBridge.switchDatabase(dbPath)
    );
    const activeEntry = updatedSettings.knownDatabases.find(
      (d) => d.path === dbPath
    );
    pushToast(t('Datenbank „{name}“ geladen', { name: activeEntry?.name || dbPath }), 'info');
  };

  const handleDeleteDatabase = async (dbPath: string, deleteFile: boolean) => {
    const targetEntry = appSettings?.knownDatabases.find(
      (d) => d.path === dbPath
    );
    const updatedSettings = await changeDatabase(() =>
      eventBridge.deleteDatabase(dbPath, deleteFile)
    );
    if (!updatedSettings.databaseReady) {
      setShowSettingsModal(true);
    }
    pushToast(
      deleteFile ? t('Datenbank „{name}“ geloescht', { name: targetEntry?.name || dbPath }) : t('Datenbank „{name}“ aus Liste entfernt', { name: targetEntry?.name || dbPath }),
      'warning'
    );
  };

  const handleToggleAutostart = async (enabled: boolean) => {
    await savePreference(() => eventBridge.setAutostart(enabled));
    pushToast(
      enabled
        ? t('Autostart beim Windows-Booten aktiviert')
        : t('Autostart beim Windows-Booten deaktiviert'),
      'info'
    );
  };
  const handleSetDefaultTimeMarkers = async (minutes: number[]) => {
    await savePreference(() => eventBridge.setDefaultTimeMarkers(minutes));
  };
  const handleSetDefaultDuration = async (value: number, unit: string) => {
    await savePreference(() => eventBridge.setDefaultDuration(value, unit));
  };

  const handleSetUILanguage = async (language: string) => {
    await savePreference(() => eventBridge.setUILanguage(language));
  };
  const handleSetPluginEnabled = (id: string, enabled: boolean) => runSettings(async () => {
    try { confirmSettings(await eventBridge.setPluginEnabled(id, enabled)); }
    finally { refreshSnapshotDependents(); }
  });
  const handleRunSetupAction = async (
    action: 'install' | 'desktop-shortcut' | 'startmenu-shortcut'
  ) => {
    await savePreference(() => eventBridge.runSetupAction(action));
    if (action === 'desktop-shortcut')
      pushToast(t('Desktop-Verknüpfung angelegt'), 'success');
    if (action === 'startmenu-shortcut')
      pushToast(t('Startmenü-Verknüpfung angelegt'), 'success');
  };
  const openSettings = async () => {
    setShowSettingsModal(true);
    if (pendingSettings.current) return;
    try {
      if (!snapshotConfirmed.current)
        await changeDatabase(() => eventBridge.getSettings());
      else await runSettings(async () => { confirmSettings(await eventBridge.getSettings()); });
    } catch (error) {
      pushToast(errorText(t('Einstellungen konnten nicht geladen werden'), error), 'warning');
    }
  };
  return {
    events,
    appSettings,
    confirmedSettings,
    settingsBusy,
    showSettingsModal,
    setShowSettingsModal,
    snapshotReady,
    snapshotRevision,
    refreshSnapshotDependents,
    mutationBusy,
    snapshotConfirmed,
    confirmedEvents,
    databaseIdentity,
    mutate,
    saves,
    waitForMutations,
    loadSnapshot,
    changeDatabase,
    handleCloseSettingsModal,
    handleCreateDatabase,
    handleOpenExistingDatabase,
    handleSwitchDatabase,
    handleDeleteDatabase,
    handleToggleAutostart,
    handleSetPluginEnabled,
    handleSetUILanguage,
    handleSetDefaultDuration,
    handleSetDefaultTimeMarkers,
    handleRunSetupAction,
    openSettings,
  };
}
