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
  onInvalidate: () => void
) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const mutationBusy = useRef(false);
  const snapshotConfirmed = useRef(false);
  const confirmedEvents = useRef<StoredEvent[]>([]);
  const databaseIdentity = useRef('');
  // Refs gate asynchronous writes immediately; render state only controls the UI.
  const mutate = async (
    operation: () => Promise<StoredEvent[]>
  ): Promise<StoredEvent[] | null> => {
    if (mutationBusy.current || !snapshotConfirmed.current) return null;
    mutationBusy.current = true;
    const database = databaseIdentity.current;
    try {
      const updated = await operation();
      if (database !== databaseIdentity.current)
        throw new Error(t('Datenbank wurde gewechselt'));
      confirmedEvents.current = updated;
      setEvents(updated);
      return updated;
    } catch (error) {
      pushToast(errorText(t('Änderung konnte nicht gespeichert werden'), error), 'warning');
      return null;
    } finally {
      mutationBusy.current = false;
    }
  };
  const invalidateSnapshot = () => {
    snapshotConfirmed.current = false;
    setSnapshotReady(false);
    databaseIdentity.current = '';
    confirmedEvents.current = [];
    setEvents([]);
    onInvalidate();
  };
  const loadSnapshot = async (isCurrent = () => true) => {
    const settings = await eventBridge.getSettings();
    if (!isCurrent()) return settings;
    setAppSettings(settings);
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
    return settings;
  };
  const handleCloseSettingsModal = () => {
    if (mutationBusy.current || !snapshotConfirmed.current) return;
    setShowSettingsModal(false);
  };

  const changeDatabase = async (operation: () => Promise<AppSettings>) => {
    if (dragIdentity.current)
      throw new Error(t('Datenbankwechsel erst nach Ende des Ziehens'));
    if (mutationBusy.current)
      throw new Error(t('Eine Aenderung wird noch gespeichert'));
    mutationBusy.current = true;
    invalidateSnapshot();
    try {
      let operationError: unknown;
      try {
        await operation();
      } catch (error) {
        operationError = error;
      }
      // Read the actual backend identity after both success and partial failure.
      let settings: AppSettings;
      try {
        settings = await loadSnapshot();
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
      mutationBusy.current = false;
    }
  };

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
      (d) => d.path.toLowerCase() === dbPath.toLowerCase()
    );
    pushToast(t('Datenbank „{name}“ geladen', { name: activeEntry?.name || dbPath }), 'info');
  };

  const handleDeleteDatabase = async (dbPath: string, deleteFile: boolean) => {
    const targetEntry = appSettings?.knownDatabases.find(
      (d) => d.path.toLowerCase() === dbPath.toLowerCase()
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
    const updatedSettings = await eventBridge.setAutostart(enabled);
    setAppSettings(updatedSettings);
    pushToast(
      enabled
        ? t('Autostart beim Windows-Booten aktiviert')
        : t('Autostart beim Windows-Booten deaktiviert'),
      'info'
    );
  };
  const handleSetUILanguage = async (language: string) => {
    const updated = await eventBridge.setUILanguage(language);
    setAppSettings(updated);
  };
  const handleRunSetupAction = async (
    action: 'install' | 'desktop-shortcut' | 'startmenu-shortcut'
  ) => {
    const updated = await eventBridge.runSetupAction(action);
    setAppSettings(updated);
    if (action === 'desktop-shortcut')
      pushToast(t('Desktop-Verknüpfung angelegt'), 'success');
    if (action === 'startmenu-shortcut')
      pushToast(t('Startmenü-Verknüpfung angelegt'), 'success');
  };
  const openSettings = async () => {
    setShowSettingsModal(true);
    try {
      if (!snapshotConfirmed.current)
        await changeDatabase(() => eventBridge.getSettings());
      else setAppSettings(await eventBridge.getSettings());
    } catch (error) {
      pushToast(errorText(t('Einstellungen konnten nicht geladen werden'), error), 'warning');
    }
  };
  return {
    events,
    appSettings,
    showSettingsModal,
    setShowSettingsModal,
    snapshotReady,
    mutationBusy,
    snapshotConfirmed,
    confirmedEvents,
    databaseIdentity,
    mutate,
    loadSnapshot,
    changeDatabase,
    handleCloseSettingsModal,
    handleCreateDatabase,
    handleOpenExistingDatabase,
    handleSwitchDatabase,
    handleDeleteDatabase,
    handleToggleAutostart,
    handleSetUILanguage,
    handleRunSetupAction,
    openSettings,
  };
}
