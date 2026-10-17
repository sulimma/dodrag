import React from 'react';
import { GitBranch, Maximize2 } from 'lucide-react';
import { TaskState } from '../domain/types';

interface MiniCornerViewProps {
  tasks: TaskState[];
  dockCorner: string;
  onDockCorner: (corner: string) => void;
  onSnapToNearestCorner: () => void;
  onSelectAndRestore: (taskId: string) => void;
  onRestoreWindow: () => void;
}

const CORNERS: Array<{ id: string; symbol: string; title: string }> = [
  { id: 'top-left', symbol: '↖', title: 'Oben links andocken' },
  { id: 'top-right', symbol: '↗', title: 'Oben rechts andocken' },
  { id: 'bottom-left', symbol: '↙', title: 'Unten links andocken' },
  { id: 'bottom-right', symbol: '↘', title: 'Unten rechts andocken' },
];

export function MiniCornerView({
  tasks,
  dockCorner,
  onDockCorner,
  onSnapToNearestCorner,
  onSelectAndRestore,
  onRestoreWindow,
}: MiniCornerViewProps) {
  return (
    <div className="h-screen w-screen bg-white border border-slate-300 shadow-lg flex flex-col select-none overflow-hidden">
      {/* Ultra-compact draggable title strip (28px) with corner-dock controls */}
      <div
        style={
          {
            WebkitAppRegion: 'drag',
            '--wails-draggable': 'drag',
          } as React.CSSProperties
        }
        className="h-7 px-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 cursor-move"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-4 h-4 rounded bg-sky-600 flex items-center justify-center shrink-0">
            <GitBranch className="w-2.5 h-2.5 text-white" />
          </div>
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
          className="flex items-center gap-0.5 shrink-0"
        >
          {CORNERS.map((c) => {
            const isCurrent = dockCorner === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDockCorner(c.id);
                }}
                title={c.title}
                className={`w-4 h-4 rounded text-[10px] leading-none flex items-center justify-center transition-colors ${
                  isCurrent
                    ? 'bg-sky-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-800 hover:bg-slate-200/80'
                }`}
              >
                {c.symbol}
              </button>
            );
          })}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRestoreWindow();
            }}
            title="Fenster wiederherstellen"
            className="ml-1 w-5 h-5 rounded text-slate-500 hover:text-sky-700 hover:bg-sky-100 flex items-center justify-center transition-colors"
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
