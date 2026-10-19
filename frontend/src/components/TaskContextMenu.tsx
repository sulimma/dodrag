import React from 'react';
import { Flame, Link2Off, CheckCircle2 } from 'lucide-react';
import type { TaskState } from '../domain/types';
import type { ContextMenuState } from '../hooks/useTaskSelection';
import { t, formatNumber } from '../i18n';
interface TaskContextMenuProps {
  contextMenu: ContextMenuState;
  task: TaskState;
  selectedTaskIds: string[];
  onClose: () => void;
  onToggleActive: (task: TaskState) => void;
  onEditTitle: (task: TaskState) => void;
  onSetConfiguredDate: (id: string, date: string, label: string) => void;
  onRemovePredecessor: (id: string, predecessor: string) => void;
  onCompleteTask: (id: string) => void;
}
// Presents task actions and routes context-menu choices to their handlers.
export function TaskContextMenu({
  contextMenu,
  task,
  selectedTaskIds,
  onClose,
  onToggleActive,
  onEditTitle,
  onSetConfiguredDate,
  onRemovePredecessor,
  onCompleteTask,
}: TaskContextMenuProps) {
  return (
    <div
      style={{
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 260)),
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 260)),
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        maxWidth: 'calc(100vw - 16px)',
      }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-64 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-xs text-slate-700"
    >
      <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
        <span className="font-mono font-semibold text-sky-700">
          {selectedTaskIds.length > 1
            ? t('{count} Tasks ausgewaehlt', { count: formatNumber(selectedTaskIds.length) })
            : t('Task {id}', { id: contextMenu.taskId })}
        </span>
        <span className="text-[10px] text-slate-400 truncate max-w-[130px]">
          {task.title}
        </span>
      </div>

      <button
        onClick={() => {
          const t = task;
          onClose();
          onToggleActive(t);
        }}
        disabled={task.predecessorIds.length > 0}
        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between disabled:opacity-40 disabled:pointer-events-none"
      >
        <span className="flex items-center gap-2">
          <Flame className="w-3.5 h-3.5 text-emerald-600" />
          {task.isActive ? t('Deaktivieren') : t('Aktivieren (Hervorheben)')}
        </span>
        <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
           {t('Space')}
        </kbd>
      </button>

      <button
        onClick={() => onEditTitle(task)}
        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
      >
        <span>{t('Titel bearbeiten (In-Place)')}</span>
        <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
          F2
        </kbd>
      </button>

      <button
        onClick={() => {
          const tId = contextMenu.taskId;
          onClose();
          onSetConfiguredDate(tId, new Date().toISOString(), t('Heute'));
        }}
        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
      >
        <span>{t('Startdatum auf Heute setzen')}</span>
      </button>

      <div className="border-t border-slate-100 mt-1 pt-1">
        <button
          onClick={() => {
            const tId = contextMenu.taskId;
            onClose();
            onCompleteTask(tId);
          }}
          className="w-full px-3 py-2 text-left hover:bg-emerald-50 text-emerald-700 flex items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('Als erledigt markieren')}
          </span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
             {t('Del')}
          </kbd>
        </button>
      </div>

      {task.predecessorIds.length > 0 && (
        <div className="border-t border-slate-100 mt-1 pt-1">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">
            {t('Vorgänger entfernen')}
          </div>
          {task.predecessorIds.map((predId) => (
            <button
              key={predId}
              onClick={() => {
                const tId = contextMenu.taskId;
                onClose();
                onRemovePredecessor(tId, predId);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-amber-50 flex items-center gap-2 text-amber-800"
            >
              <Link2Off className="w-3.5 h-3.5" />
              <span>{t('Vorgänger {id} lösen', { id: predId })}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
