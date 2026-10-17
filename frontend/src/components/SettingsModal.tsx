import React, { useState } from 'react';
import {
  Check,
  Database,
  FolderOpen,
  Plus,
  Settings,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { AppSettings, DatabaseEntry } from '../bridge/eventBridge';

interface SettingsModalProps {
  settings: AppSettings;
  isFirstRun: boolean;
  onClose: () => void;
  onSelectFolder: () => Promise<string>;
  onCreateDatabase: (folderPath: string, dbName: string) => Promise<void>;
  onOpenExistingDatabase: () => Promise<void>;
  onSwitchDatabase: (dbPath: string) => Promise<void>;
  onDeleteDatabase: (dbPath: string) => Promise<void>;
}

export function SettingsModal({
  settings,
  isFirstRun,
  onClose,
  onSelectFolder,
  onCreateDatabase,
  onOpenExistingDatabase,
  onSwitchDatabase,
  onDeleteDatabase,
}: SettingsModalProps) {
  const [folderPath, setFolderPath] = useState<string>('');
  const [dbName, setDbName] = useState<string>('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const handleBrowseFolder = async () => {
    setErrorMsg(null);
    try {
      const picked = await onSelectFolder();
      if (picked) {
        setFolderPath(picked);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ordnerauswahl fehlgeschlagen');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!dbName.trim()) {
      setErrorMsg('Bitte einen Namen für die neue Datenbank eingeben.');
      return;
    }
    setBusy(true);
    try {
      await onCreateDatabase(folderPath.trim(), dbName.trim());
      setDbName('');
    } catch (err: any) {
      setErrorMsg(
        typeof err === 'string'
          ? err
          : err?.message || 'Datenbank konnte nicht angelegt werden.'
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
        typeof err === 'string'
          ? err
          : err?.message || 'Wechsel der Datenbank fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async (path: string) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await onDeleteDatabase(path);
      setConfirmDeletePath(null);
    } catch (err: any) {
      setErrorMsg(
        typeof err === 'string'
          ? err
          : err?.message || 'Löschen der Datenbank fehlgeschlagen.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
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
                {isFirstRun
                  ? 'Willkommen bei DoDrag – Datenbank wählen'
                  : 'Einstellungen & Datenbanken'}
              </h2>
              <p className="text-xs text-slate-500">
                Speicherort z. B. für Google Drive Sync & Backup verwalten
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {isFirstRun && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-xs text-sky-900">
              <strong>Erster Start:</strong> Du kannst direkt mit der{' '}
              <span className="font-semibold">Demo-Datenbank</span> starten oder
              unten eine eigene Datenbank (z. B. in deinem Google-Drive-Ordner)
              anlegen.
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Known Databases on this PC */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                <span>Bekannte Datenbanken</span>
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={onOpenExistingDatabase}
                className="text-xs font-medium text-sky-700 hover:text-sky-800 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-sky-50 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Vorhandene Datei öffnen…</span>
              </button>
            </div>

            <div className="space-y-2">
              {settings.knownDatabases.map((entry) => {
                const isActive =
                  entry.path.toLowerCase() ===
                  settings.activeDatabasePath.toLowerCase();
                const isConfirmingDelete = confirmDeletePath === entry.path;

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
                          if (!busy) handleSwitch(entry);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {entry.name}
                          </span>
                          {entry.isDemo && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                              Demo
                            </span>
                          )}
                          {isActive && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-0.5">
                              <Check className="w-3 h-3" />
                              Aktiv
                            </span>
                          )}
                        </div>
                        <div
                          className="text-[11px] font-mono text-slate-500 truncate mt-0.5"
                          title={entry.path}
                        >
                          {entry.path}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isActive ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSwitch(entry)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-sky-600 hover:text-white text-slate-700 transition-colors"
                          >
                            Verwenden
                          </button>
                        ) : (
                          isFirstRun && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={onClose}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-700 text-white transition-colors"
                            >
                              Auswählen
                            </button>
                          )
                        )}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmDeletePath(
                              isConfirmingDelete ? null : entry.path
                            )
                          }
                          title="Datenbank löschen"
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
                          Datenbank „{entry.name}“ wirklich vom Rechner löschen?
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmDeletePath(null)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                          >
                            Abbrechen
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleConfirmDelete(entry.path)}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                          >
                            Endgültig löschen
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
              <span>Neue Datenbank anlegen</span>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Speicherort (z. B. Google-Drive-Ordner)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder="Standard: %APPDATA%\DoDrag (oder Ordner wählen)"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-sky-600" />
                    <span>Ordner wählen…</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Name der neuen Datenbank
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    placeholder="z. B. meine-aufgaben.db"
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || !dbName.trim()}
                    className="px-3.5 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
                  >
                    Anlegen & Öffnen
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 font-mono truncate max-w-[360px]">
            Konfiguration: %APPDATA%\DoDrag\settings.json
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 text-white text-xs font-medium hover:bg-slate-900 transition-colors"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
