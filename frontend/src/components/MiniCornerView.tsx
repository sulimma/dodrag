import React from 'react';
import { Maximize2 } from 'lucide-react';
import { TaskState } from '../domain/types';
import appIcon from '../assets/app-icon.png';

interface MiniCornerViewProps {
  tasks: TaskState[];
  onSelectAndRestore: (taskId: string) => void;
  onRestoreWindow: () => void;
}

export function MiniCornerView({
  tasks,
  onSelectAndRestore,
  onRestoreWindow,
}: MiniCornerViewProps) {
  return (
    <div className="h-screen w-screen bg-white border border-slate-300 shadow-lg flex flex-col select-none overflow-hidden">
      {/* Ultra-compact draggable title strip (28px) — drag near any corner of any monitor to snap */}
      <div
        style={
          {
            WebkitAppRegion: 'drag',
            '--wails-draggable': 'drag',
          } as React.CSSProperties
        }
        title="Mit der Maus in eine beliebige Bildschirmecke ziehen zum Andocken"
        className="h-7 px-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 cursor-move"
      >
        <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
          <img src={appIcon} alt="" draggable={false} className="w-4 h-4 shrink-0" />
          <span className="text-[11px] font-bold text-slate-700 truncate">
            DoDrag ({tasks.length})
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
          className="flex items-center shrink-0"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRestoreWindow();
            }}
            title="Fenster wiederherstellen"
            className="w-5 h-5 rounded text-slate-500 hover:text-sky-700 hover:bg-sky-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Compact Vertical Task List (limited to 4 entries = 112px max height, mouse-wheel scrollable) */}
      <div className="max-h-[112px] overflow-y-auto divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <div
            onClick={onRestoreWindow}
            className="h-7 px-2.5 flex items-center text-xs text-slate-400 italic cursor-pointer hover:bg-slate-50 truncate"
          >
            Keine offenen Tasks
          </div>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelectAndRestore(task.id)}
              title={task.title}
              className={`w-full h-7 px-2.5 flex items-center text-left text-xs truncate transition-colors cursor-pointer ${
                task.isActive
                  ? 'bg-emerald-50/90 text-emerald-950 font-semibold hover:bg-emerald-100/90'
                  : 'bg-white text-slate-800 hover:bg-sky-50 hover:text-sky-900'
              }`}
            >
              <span className="truncate">{task.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
