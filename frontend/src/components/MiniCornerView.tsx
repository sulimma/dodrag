import React from 'react';
import { Maximize2, Flame, Check } from 'lucide-react';
import type { QuickResubmitTargetId } from '../domain/projector';
import type { TaskState } from '../domain/types';
import appIcon from '../assets/app-icon.png';
import { t } from '../i18n';
import type { InlineEditor } from './inlineEditor';
import { TaskTitle } from './TaskTitle';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import { shortcutLabel } from '../hooks/keyboardNavigation';

interface MiniCornerViewProps {
  tasks: TaskState[];
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  listScrollRef?: React.RefObject<HTMLDivElement>;
  onSelectAndRestore: (taskId: string) => void;
  onRestoreWindow: () => void;
  onResubmitTasks: (id: string, target: QuickResubmitTargetId) => void;
  onCompleteTask: (id: string) => void;
  onToggleActive: (task: TaskState) => void;
  onContextMenuTask: (event: React.MouseEvent, id: string) => void;
  titleEditor: InlineEditor;
  newTaskTitle: string;
  setNewTaskTitle: (title: string) => void;
  newTaskInputRef: React.RefObject<HTMLInputElement>;
  snapshotReady: boolean;
  onCreateTask: (event: React.FormEvent) => void;
}

// Shows a compact task list and restores the main window on interaction.
export function MiniCornerView({
  tasks,
  selectedTaskId,
  onSelectTask,
  listScrollRef,
  onSelectAndRestore,
  onRestoreWindow,
  onResubmitTasks,
  onCompleteTask,
  onToggleActive,
  onContextMenuTask,
  titleEditor,
  newTaskTitle,
  setNewTaskTitle,
  newTaskInputRef,
  snapshotReady,
  onCreateTask,
}: MiniCornerViewProps) {
  return (
    <div className="h-screen w-screen bg-white border border-slate-300 shadow-lg flex flex-col select-none overflow-hidden">
      {/* Ultra-compact draggable title strip (28px) — drag near any corner of any monitor to snap */}
      <div
        data-shortcut-region="0"
        style={
          {
            WebkitAppRegion: 'drag',
            '--wails-draggable': 'drag',
          } as React.CSSProperties
        }
        title={t('Mit der Maus in eine beliebige Bildschirmecke ziehen zum Andocken')}
        className="h-7 px-2 bg-slate-100 border-b border-slate-200 flex items-center gap-2 shrink-0 cursor-move"
      >
        <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
          <img src={appIcon} alt="" draggable={false} className="w-4 h-4 shrink-0" />
          <span className="text-[11px] font-bold text-slate-700 truncate">
            DoDrag
          </span>
        </div>

        <div
          style={
            {
              WebkitAppRegion: 'no-drag',
              '--wails-draggable': 'no-drag',
            } as React.CSSProperties
          }
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          className="flex items-center gap-1 flex-1 min-w-0 cursor-default"
        >
          <form onSubmit={onCreateTask} className="flex-1 min-w-0">
            <input
              ref={newTaskInputRef}
              type="text"
              disabled={!snapshotReady}
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              aria-label={t('Task hinzufügen (Enter)')}
              placeholder={t('Task hinzufügen (Enter)')}
              className="w-full h-5 px-1 text-[11px] select-text rounded border border-slate-300 bg-white focus:outline-none focus:border-sky-500"
            />
          </form>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRestoreWindow();
            }}
            title={t('Fenster wiederherstellen')}
            className="w-5 h-5 rounded text-slate-500 hover:text-sky-700 hover:bg-sky-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Compact Vertical Task List (limited to 4 entries = 112px max height, mouse-wheel scrollable) */}
      <div ref={listScrollRef} tabIndex={0} data-shortcut-region="1" className="max-h-[112px] overflow-y-auto divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <div
            onClick={onRestoreWindow}
            className="h-7 px-2.5 flex items-center text-xs text-slate-400 italic cursor-pointer hover:bg-slate-50 truncate"
          >
            {t('Keine offenen Tasks')}
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              data-mini-task-id={task.id}
              data-source-task-id={task.id}
              data-task-selected={selectedTaskId === task.id ? 'true' : undefined}
              tabIndex={0}
              onFocus={() => onSelectTask?.(task.id)}
              onClick={() => onSelectTask?.(task.id)}
              onDoubleClick={event => {
                if ((event.target as Element).closest('input,textarea,button,[contenteditable="true"]')) return;
                event.stopPropagation(); onSelectAndRestore(task.id);
              }}
              onContextMenu={(event) => onContextMenuTask(event, task.id)}
              className={`group w-full h-7 px-2 flex items-center gap-1 text-xs transition-colors ${
                selectedTaskId === task.id
                  ? 'bg-sky-100 text-sky-950 ring-1 ring-inset ring-sky-400'
                  : task.isActive
                  ? 'bg-emerald-50/90 text-emerald-950 font-semibold hover:bg-emerald-100/90'
                  : 'bg-white text-slate-800 hover:bg-sky-50 hover:text-sky-900'
              }`}
            >
              <TaskTitle task={task} editor={titleEditor} className="flex-1 min-w-0 truncate text-left text-xs" />
              <TaskChecklistBadge progress={task.checklistProgress} compact />
              <div className="flex items-center gap-0.5 shrink-0 invisible group-hover:visible group-focus-within:visible">
                <button
                  type="button"
                  onClick={() => onToggleActive(task)}
                  aria-pressed={task.isActive}
                  aria-label={task.isActive ? t('Deaktivieren') : t('Aktivieren (Hervorheben)')}
                  title={task.isActive ? t('Deaktivieren') : t('Aktivieren (Hervorheben)')}
                  className={`w-6 h-6 rounded flex items-center justify-center cursor-pointer ${task.isActive ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-100'}`}
                >
                  <Flame className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onResubmitTasks(task.id, 'plus_1d')}
                  aria-label={t('+1 Tag')}
                  title={shortcutLabel(t('+1 Tag'), 'Ctrl++')} aria-keyshortcuts="Control+Plus"
                  className="w-6 h-6 rounded text-[11px] font-semibold text-sky-700 hover:bg-sky-100 cursor-pointer"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => onCompleteTask(task.id)}
                  aria-label={t('Als erledigt markieren')}
                  title={t('Als erledigt markieren')}
                  className="w-6 h-6 rounded flex items-center justify-center text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
