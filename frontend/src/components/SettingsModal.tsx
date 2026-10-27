import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Database,
  Download,
  FolderOpen,
  Menu,
  Monitor,
  Plus,
  Power,
  Settings,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { eventBridge, type AppSettings, type DatabaseEntry } from '../bridge/eventBridge';
import { t, formatDate, useLanguage, supportedLanguages, languageNames, errorText } from '../i18n';
import { contextMenuAnchor } from '../hooks/keyboardNavigation';

const PROJECT_URL = 'https://github.com/sulimma/dodrag';

interface SettingsModalProps {
  settings: AppSettings;
  onClose: () => void;
  onReloadDatabase?: () => Promise<void>;
  onSelectFolder: () => Promise<string>;
   onCreateDatabase: (folderPath: string, dbName: string, seedDemo: boolean) => Promise<void>;
  onOpenExistingDatabase: () => Promise<void>;
  onSwitchDatabase: (dbPath: string) => Promise<void>;
  onDeleteDatabase: (dbPath: string, deleteFile: boolean) => Promise<void>;
  onToggleAutostart: (enabled: boolean) => Promise<void>;
  onSetUILanguage?: (language: string) => Promise<void>;
  onRunSetupAction?: (action: 'install' | 'desktop-shortcut' | 'startmenu-shortcut') => Promise<void>;
  onOpenFolderInExplorer?: (path: string, isFile: boolean) => Promise<void>;
  onOpenFolderInVSCode?: (path: string, isFile: boolean) => Promise<void>;
}

// Build time arrives as RFC3339 (UTC); show it in the local zone, keeping the raw value on parse failure.
export function formatBuildTime(raw?: string): string {
  if (!raw) return t('unbekannt');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatDate(parsed, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(', ', ' ');
}

// One definition for every displayed path: text cursor, selectable text and
// the same context-menu wiring. Database paths pass isFile so the backend opens
// the containing folder.
function PathLabel({
  path,
  isFile,
  onContextMenu,
  className,
  children,
}: {
  path: string;
  isFile: boolean;
  onContextMenu: (event: React.MouseEvent, path: string, isFile: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      tabIndex={0} data-context-menu-target="true"
      className={`cursor-text select-text ${className ?? ''}`}
      title={path}
      onContextMenu={(event) => onContextMenu(event, path, isFile)}
    >
      {children ?? path}
    </div>
  );
}

// Manages database selection, creation, deletion, and application settings.
export function SettingsModal({
  settings,
  onClose,
  onReloadDatabase,
  onSelectFolder,
  onCreateDatabase,
  onOpenExistingDatabase,
  onSwitchDatabase,
  onDeleteDatabase,
  onToggleAutostart,
  onSetUILanguage,
  onRunSetupAction,
  onOpenFolderInExplorer,
  onOpenFolderInVSCode,
}: SettingsModalProps) {
  const language = useLanguage();
  const [folderPath, setFolderPath] = useState<string>('');
  const [dbName, setDbName] = useState<string>('');
  const [seedDemo, setSeedDemo] = useState(() => !settings.knownDatabases.some(entry => entry.exists));
  const seedDemoTouched = useRef(false);
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState(false);
  const [busy, setBusy] = useState<boolean>(false);
  const pathMenuRequest = useRef<object | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pathMenuRequest.current = null;
    };
  }, []);

  const isDbReady = Boolean(settings.databaseReady);
  const setup = settings.setup;
  const currentDir = setup?.currentDir;
  const setupNeeded = Boolean(setup && (!setup.programInstalled || !setup.desktopShortcut || !setup.startMenuShortcut));

  // A database created while this dialog is open (for example the demo database)
  // must clear the default; an explicit user choice is kept.
  useEffect(() => {
    if (!seedDemoTouched.current)
      setSeedDemo(!settings.knownDatabases.some(entry => entry.exists));
  }, [settings.knownDatabases]);

  const openProjectPage = () => {
    if (window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(PROJECT_URL);
    else window.open(PROJECT_URL, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      event.preventDefault();
      if (pathMenuRequest.current) {
        pathMenuRequest.current = null;
        return;
      }
      if (isDbReady && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDbReady, busy, onClose]);

  const handleBrowseFolder = async () => {
    setErrorMsg(null);
    try {
      const picked = await onSelectFolder();
      if (picked) {
        setFolderPath(picked);
      }
    } catch (err: any) {
      setErrorMsg(errorText(t('Ordnerauswahl fehlgeschlagen'), err));
    }
  };

  const handleSetupAction = async (action: 'install' | 'desktop-shortcut' | 'startmenu-shortcut') => {
    if (!onRunSetupAction) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await onRunSetupAction(action);
    } catch (err: any) {
      setErrorMsg(errorText(
        action === 'install'
          ? t('Installation konnte nicht abgeschlossen werden.')
          : t('Verknüpfung konnte nicht angelegt werden.'),
        err
      ));
    } finally {
      setBusy(false);
    }
  };

  const openPathMenu = async (event: React.MouseEvent, path: string, isFile: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const request = {};
    pathMenuRequest.current = request;
    const items = [
      { id: 'explorer', label: t('Im Explorer öffnen'), disabled: busy || !onOpenFolderInExplorer },
      { id: 'vscode', label: t('In VS Code öffnen'), disabled: busy || !onOpenFolderInVSCode },
    ];
    try {
      const id = await eventBridge.showTaskContextMenu(items, contextMenuAnchor(event));
      if (pathMenuRequest.current !== request) return;
      pathMenuRequest.current = null;
      if (busyRef.current || !items.some(item => item.id === id && !item.disabled)) return;
      if (id === 'explorer' || id === 'vscode') await handlePathAction(id, { path, isFile });
    } catch (err) {
      if (pathMenuRequest.current !== request) return;
      pathMenuRequest.current = null;
      setErrorMsg(errorText(t('Kontextmenü konnte nicht geöffnet werden'), err));
    }
  };

  const handlePathAction = async (action: 'explorer' | 'vscode', target: { path: string; isFile: boolean }) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      if (action === 'explorer') await onOpenFolderInExplorer?.(target.path, target.isFile);
      else await onOpenFolderInVSCode?.(target.path, target.isFile);
    } catch (err: any) {
      if (mounted.current) setErrorMsg(errorText(t('Ordner konnte nicht geöffnet werden.'), err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleCacheAction = async (action: 'clear' | 'explorer') => {
    if (busyRef.current || !mounted.current) return;
    pathMenuRequest.current = null;
    busyRef.current = true;
    setBusy(true);
    setErrorMsg(null);
    setCacheStatus(false);
    try {
      if (action === 'clear') {
        await eventBridge.clearPreviewCache();
        if (mounted.current) setCacheStatus(true);
      } else {
        await eventBridge.openPreviewCacheInExplorer();
      }
    } catch (err) {
      if (mounted.current) setErrorMsg(errorText(
        action === 'clear'
          ? t('Vorschau-Cache konnte nicht gelöscht werden.')
          : t('Ordner konnte nicht geöffnet werden.'),
        err
      ));
    } finally {
      if (mounted.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const openCacheMenu = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const request = {};
    pathMenuRequest.current = request;
    const items = [{
      id: 'open-cache-explorer',
      label: t('Cache-Ordner im File-Explorer öffnen'),
      disabled: busyRef.current,
    }];
    try {
      const id = await eventBridge.showTaskContextMenu(items, contextMenuAnchor(event));
      if (pathMenuRequest.current !== request) return;
      pathMenuRequest.current = null;
      if (id === 'open-cache-explorer' && !items[0].disabled) await handleCacheAction('explorer');
    } catch (err) {
      if (pathMenuRequest.current !== request) return;
      pathMenuRequest.current = null;
      setErrorMsg(errorText(t('Kontextmenü konnte nicht geöffnet werden'), err));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!dbName.trim()) {
      setErrorMsg(t('Bitte einen Namen für die neue Datenbank eingeben.'));
      return;
    }
    setBusy(true);
    try {
      await onCreateDatabase(folderPath.trim(), dbName.trim(), seedDemo);
      setDbName('');
    } catch (err: any) {
      setErrorMsg(
        errorText(t('Datenbank konnte nicht angelegt werden.'), err)
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (entry: DatabaseEntry) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await onSwitchDatabase(entry.path);
    } catch (err: any) {
      setErrorMsg(
        errorText(t('Wechsel der Datenbank fehlgeschlagen.'), err)
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async (path: string, deleteFile: boolean) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await onDeleteDatabase(path, deleteFile);
      setConfirmDeletePath(null);
    } catch (err: any) {
      setErrorMsg(
        errorText(t('Löschen der Datenbank fehlgeschlagen.'), err)
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => {
        if (isDbReady && !busy) onClose();
      }}
    >
      <div
        className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-100 text-sky-700">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {!isDbReady
                  ? t('Datenbank auswählen oder anlegen')
                  : t('Einstellungen & Datenbanken')}
              </h2>
              <p className="text-xs text-slate-500">
                {t('Speicherort z. B. für Google Drive Sync & Backup verwalten')}
              </p>
            </div>
          </div>
          {isDbReady && (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              title={t('Schließen')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {!isDbReady && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
              {settings.activeDatabasePath ? (
                <>
                  <strong>{t('Datenbank nicht verfügbar:')}</strong>{' '}
                  {t('Die ausgewählte Datenbank ({path}) konnte nicht geöffnet werden (evtl. verschoben oder gelöscht). Bitte wähle eine Datenbank aus oder lege eine neue an.', { path: settings.activeDatabasePath })}
                </>
              ) : (
                <>
                  <strong>{t('Keine Datenbank geöffnet:')}</strong>{' '}
                  {t('Bitte wähle eine vorhandene Datenbank (z. B. die Demo-Datenbank) oder lege unten eine neue Datenbank an.')}
                </>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!isDbReady && onReloadDatabase && (
            <button type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              setErrorMsg(null);
              try { await onReloadDatabase(); }
              catch (error) { setErrorMsg(errorText(t('Datenbank konnte nicht geladen werden'), error)); }
              finally { setBusy(false); }
            }} className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs disabled:opacity-40">
              {t('Aktive Datenbank erneut laden')}
            </button>
          )}

          {/* Section 0: Installation & Shortcuts */}
          {setupNeeded && setup && onRunSetupAction && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-sky-600" />
                <span>{t('Installation & Verknüpfungen')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {!setup.programInstalled && (
                  <button
                    type="button"
                    disabled={busy}
                    title={t('Kopiert DoDrag nach {path}. Beim nächsten Start wird die installierte Version verwendet.', { path: setup.installPath })}
                    onClick={() => handleSetupAction('install')}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{t('Programm in den Benutzerordner installieren')}</span>
                  </button>
                )}
                {!setup.desktopShortcut && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSetupAction('desktop-shortcut')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Monitor className="w-3.5 h-3.5 text-sky-600" />
                    <span>{t('Desktop-Verknüpfung anlegen')}</span>
                  </button>
                )}
                {!setup.startMenuShortcut && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSetupAction('startmenu-shortcut')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Menu className="w-3.5 h-3.5 text-sky-600" />
                    <span>{t('Startmenü-Verknüpfung anlegen')}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Section 1: Known Databases on this PC */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                <span>{t('Bekannte Datenbanken')}</span>
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true); setErrorMsg(null);
                  try { await onOpenExistingDatabase(); } catch (error) { setErrorMsg(errorText(t('Datenbank konnte nicht geöffnet werden'), error)); } finally { setBusy(false); }
                }}
                className="text-xs font-medium text-sky-700 hover:text-sky-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t('Vorhandene Datei öffnen…')}</span>
              </button>
            </div>

            <div className="space-y-2">
              {settings.knownDatabases.map((entry) => {
                const isActive =
                  isDbReady &&
                  Boolean(settings.activeDatabasePath) &&
                  entry.path.toLowerCase() ===
                    settings.activeDatabasePath.toLowerCase();
                const isConfirmingDelete = confirmDeletePath === entry.path;
                const isMissing = !entry.exists;

                return (
                  <div
                    key={entry.path}
                    className={`rounded-xl border p-3 transition-all ${
                      isActive
                        ? 'bg-sky-50/70 border-sky-400 ring-2 ring-sky-400/20'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => {
                           if (!busy && !isMissing && !isActive) handleSwitch(entry);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {entry.name}
                          </span>
                          {entry.isDemo && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                              {t('Demo')}
                            </span>
                          )}
                          {isActive && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-0.5">
                              <Check className="w-3 h-3" />
                              {t('Aktiv')}
                            </span>
                          )}
                          {isMissing && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                              {t('Datei fehlt')}
                            </span>
                          )}
                        </div>
                        <PathLabel
                          path={entry.path}
                          isFile
                          onContextMenu={openPathMenu}
                          className="text-[11px] font-mono text-slate-500 truncate mt-0.5"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            disabled={busy || isMissing}
                            onClick={() => handleSwitch(entry)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-sky-600 hover:text-white text-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          >
                            {t('Verwenden')}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmDeletePath(
                              isConfirmingDelete ? null : entry.path
                            )
                          }
                          title={t('Datenbank löschen')}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            isConfirmingDelete
                              ? 'bg-rose-100 border-rose-300 text-rose-700'
                              : 'bg-white border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isConfirmingDelete && (
                      <div className="mt-2.5 pt-2.5 border-t border-rose-200 flex items-center justify-between gap-2 bg-rose-50/70 -mx-3 -mb-3 px-3 py-2 rounded-b-xl">
                        <span className="text-xs text-rose-800 font-medium">
                          {t('Datenbank „{name}“ wirklich vom Rechner löschen?', { name: entry.name })}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDeletePath(null)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                          >
                            {t('Abbrechen')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleConfirmDelete(entry.path, false)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-300"
                          >
                            {t('Aus Liste entfernen')}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleConfirmDelete(entry.path, true)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                          >
                            {t('Endgültig löschen')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Create a New Database */}
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-sky-600" />
              <span>{t('Neue Datenbank anlegen')}</span>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={seedDemo} onChange={event => { seedDemoTouched.current = true; setSeedDemo(event.target.checked); }} disabled={busy} />
                {t('Mit Demodaten befuellen')}
              </label>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t('Speicherort (z. B. Google-Drive-Ordner)')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder={t('Standard: %APPDATA%\\DoDrag (oder Ordner wählen)')}
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-sky-600" />
                    <span>{t('Ordner wählen…')}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t('Name der neuen Datenbank')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    placeholder={t('z. B. meine-aufgaben.db')}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || !dbName.trim()}
                    className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
                  >
                    {t('Anlegen & Öffnen')}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Section 3: Windows Autostart */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-600 mt-0.5">
                <Power className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {t('Beim Booten automatisch starten')}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('Startet DoDrag automatisch bei der Windows-Anmeldung im Hintergrund (minimiert).')}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-label={t('Beim Booten automatisch starten')}
              aria-checked={Boolean(settings.autostart)}
              disabled={busy}
              onClick={async () => {
                setErrorMsg(null);
                setBusy(true);
                try {
                  await onToggleAutostart(!settings.autostart);
                } catch (err: any) {
                  setErrorMsg(
                    errorText(t('Autostart-Einstellung konnte nicht geändert werden.'), err)
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings.autostart ? 'bg-sky-600' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  settings.autostart ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4">
            <label htmlFor="ui-language" className="text-sm font-semibold text-slate-900">{t('Sprache (Language)')}</label>
            <select id="ui-language" value={language} disabled={busy || !onSetUILanguage}
              className="max-w-[65%] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              onChange={async event => {
                const next = event.target.value;
                setBusy(true); setErrorMsg(null);
                try { await onSetUILanguage?.(next); }
                catch (error) { setErrorMsg(errorText(t('Sprache konnte nicht geändert werden'), error)); }
                finally { setBusy(false); }
              }}>
              {supportedLanguages.map(code => <option key={code} value={code} lang={code}>{languageNames[code]}</option>)}
            </select>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2" onContextMenu={openCacheMenu}>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleCacheAction('clear')}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t('Cache löschen')}</span>
            </button>
            {cacheStatus && (
              <p role="status" className="text-xs text-emerald-700">{t('Vorschau-Cache wurde gelöscht.')}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {currentDir && (
              <PathLabel
                path={currentDir}
                isFile={false}
                onContextMenu={openPathMenu}
                className="flex items-center gap-1 text-[10px] font-mono text-slate-400 mb-0.5"
              >
                <FolderOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">{currentDir}</span>
              </PathLabel>
            )}
            <button
              type="button"
              onClick={openProjectPage}
              title={t('GitHub-Projekt im Browser öffnen')}
              className="block max-w-full text-left text-[11px] text-slate-500 font-mono truncate hover:text-sky-700 hover:underline"
            >
              {t('DoDrag v{version} · Build {time}', { version: settings.version || 'dev', time: formatBuildTime(settings.buildTime) })}
            </button>
          </div>
          <button
            type="button"
            disabled={!isDbReady || busy}
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {t('Fertig')}
          </button>
        </div>
      </div>

    </div>
  );
}
