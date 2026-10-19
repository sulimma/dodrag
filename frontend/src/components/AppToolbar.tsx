import React from 'react';
import {
  Calendar,
  List,
  Network,
  Plus,
  Undo2,
  Redo2,
  Settings,
  Minimize2,
  HelpCircle,
} from 'lucide-react';
import appIcon from '../assets/app-icon.png';
import { t } from '../i18n';
export type ViewMode = 'list' | 'network' | 'gantt';
interface AppToolbarProps {
  viewMode: ViewMode;
  setViewMode: (view: ViewMode) => void;
  nextTaskId: string;
  canUndo: boolean;
  canRedo: boolean;
  snapshotReady: boolean;
  newTaskTitle: string;
  setNewTaskTitle: (title: string) => void;
  newTaskInputRef: React.RefObject<HTMLInputElement>;
  onCreateTask: (event: React.FormEvent) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSettings: () => void;
  onMiniMode: () => void;
  onHelp: () => void;
}
// Presents view controls, task creation, history actions, and app settings.
export function AppToolbar({
  viewMode,
  setViewMode,
  nextTaskId,
  canUndo,
  canRedo,
  snapshotReady,
  newTaskTitle,
  setNewTaskTitle,
  newTaskInputRef,
  onCreateTask,
  onUndo,
  onRedo,
  onSettings,
  onMiniMode,
  onHelp,
}: AppToolbarProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white/90 backdrop-blur-md z-20 shadow-sm shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <img
            src={appIcon}
            alt=""
            draggable={false}
            className="w-8 h-8 shrink-0"
          />
          <h1 className="text-base font-bold tracking-tight text-slate-900">
            DoDrag
          </h1>
        </div>

        {/* View Switcher: Liste vs. Netzplan vs. Gantt */}
        <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            <span>{t('Liste')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('network')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'network'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>{t('Netzplan')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('gantt')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'gantt'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>{t('Gantt')}</span>
          </button>
        </div>
      </div>

      {/* Quick Task Creation Bar */}
      <form onSubmit={onCreateTask} className="flex-1 max-w-md mx-6">
        <div className="relative flex items-center">
          <span className="absolute left-3 text-xs font-mono font-medium text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
            {nextTaskId}
          </span>
          <input
            ref={newTaskInputRef}
            type="text"
            disabled={!snapshotReady}
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder={t('Neues kleines TODO eingeben... (Taste N)')}
            className="w-full pl-20 pr-9 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
          />
          <button
            type="submit"
            disabled={!snapshotReady}
            title={t('Task hinzufügen (Enter)')}
            className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Undo/Redo & Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={t('Rückgängig (Ctrl+Z)')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>{t('Undo')}</span>
          </button>
          <div className="w-px h-4 bg-slate-300 mx-0.5" />
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title={t('Wiederherstellen (Ctrl+Y)')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>{t('Redo')}</span>
          </button>
        </div>

        <button
          onClick={onSettings}
          title={t('Einstellungen & Datenbanken')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={onMiniMode}
          title={t('Minimieren (Kompaktansicht in Bildschirmecke)')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
        >
          <Minimize2 className="w-4 h-4" />
        </button>

        <button
          onClick={onHelp}
          title={t('Tastenkürzel & Bedienung (?)')}
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
