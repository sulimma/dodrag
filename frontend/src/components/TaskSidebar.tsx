import React, { useLayoutEffect, useRef } from 'react';
import { Calendar, CalendarClock, CheckCircle2 } from 'lucide-react';
import type { QuickResubmitTargetId } from '../domain/projector';
import { QUICK_RESUBMIT_TARGETS, formatDateHeading, toDateKey } from '../domain/projector';
import type { TaskState } from '../domain/types';
import type { TaskViewInteractions } from './taskInteractions';
import { DateLayerLine } from './DateLayerLine';
import { t, formatNumber } from '../i18n';
// Icon tints only; labels stay here so the i18n AST check sees the keys.
const RESUBMIT_ICONS: Record<QuickResubmitTargetId, React.ReactNode> = {
  plus_1d: <CalendarClock className="w-4 h-4 text-teal-600" />,
  next_week: <Calendar className="w-4 h-4 text-indigo-600" />,
  plus_7d: <Calendar className="w-4 h-4 text-violet-600" />,
  next_month: <Calendar className="w-4 h-4 text-fuchsia-600" />,
};
interface TaskSidebarProps {
  tasks: Record<string, TaskState>;
  completedTasks: TaskState[];
  now: Date;
  interactions: Pick<
    TaskViewInteractions,
    | 'selectedTaskId'
    | 'activeDropTargetKey'
    | 'draggedTaskId'
    | 'setActiveDropTargetKey'
    | 'onDragEndTask'
  >;
  onCompleteTask: (id: string, fromDrag?: boolean) => void;
  onResubmitTasks: (id: string, target: QuickResubmitTargetId, fromDrag?: boolean) => void;
  onReopenTask: (id: string) => void;
}
export function TaskSidebar({
  tasks,
  completedTasks,
  now,
  interactions,
  onResubmitTasks,
  onCompleteTask,
  onReopenTask,
}: TaskSidebarProps) {
  const {
    selectedTaskId,
    activeDropTargetKey,
    draggedTaskId,
    setActiveDropTargetKey,
    onDragEndTask,
  } = interactions;
  const completedScrollRef = useRef<HTMLDivElement>(null);
  const completionKey = JSON.stringify(completedTasks.map(task => [task.id, task.completedAt]));
  useLayoutEffect(() => {
    const container = completedScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [completionKey]);
  const completedDateKeys = completedTasks.map(task =>
    toDateKey(new Date(task.completedAt ?? task.createdAt))
  );
  return (
    <aside className="w-80 border-l border-slate-200 bg-white/90 p-4 flex flex-col gap-4 shrink-0 overflow-hidden">
      <div className="space-y-2 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">
          {t('Wiedervorlage')}
        </h2>

        <div className="space-y-1.5">
          {QUICK_RESUBMIT_TARGETS.map((target) => {
            const targetKey = `resubmit:${target.id}`;
            const isOver = activeDropTargetKey === targetKey;
            return (
              <div
                key={target.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (activeDropTargetKey !== targetKey) {
                    setActiveDropTargetKey(targetKey);
                  }
                }}
                onDragLeave={() => {
                  if (activeDropTargetKey === targetKey) {
                    setActiveDropTargetKey(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const tId =
                    draggedTaskId || e.dataTransfer.getData('text/plain');
                  if (tId && tasks[tId]) {
                    onResubmitTasks(tId, target.id, true);
                  }
                  onDragEndTask();
                }}
                onClick={() => {
                  if (selectedTaskId && tasks[selectedTaskId]) {
                    onResubmitTasks(selectedTaskId, target.id);
                  }
                }}
                className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex items-center justify-between ${
                  isOver
                    ? 'bg-sky-50 border-sky-400 shadow-sm'
                    : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
                    {RESUBMIT_ICONS[target.id]}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-800">
                      {t(target.label)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {t(target.sublabel)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Permanent "Erledigte Tasks" List acting directly as the Drop Target to complete tasks */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (activeDropTargetKey !== 'completed-list-dropzone') {
            setActiveDropTargetKey('completed-list-dropzone');
          }
        }}
        onDragLeave={() => {
          if (activeDropTargetKey === 'completed-list-dropzone') {
            setActiveDropTargetKey(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const tId = draggedTaskId || e.dataTransfer.getData('text/plain');
          if (tId) {
            onCompleteTask(tId, true);
          }
          onDragEndTask();
        }}
        className={`flex-1 min-h-0 flex flex-col rounded-xl border-2 transition-colors overflow-hidden ${
          activeDropTargetKey === 'completed-list-dropzone'
            ? 'bg-emerald-50/90 border-emerald-500 shadow-sm'
            : 'bg-slate-50/70 border-slate-200/90'
        }`}
      >
        <div className="px-3 py-2.5 border-b border-slate-200/80 bg-white/70 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {t('Erledigte Tasks ({count})', { count: formatNumber(completedTasks.length) })}
          </span>
        </div>

        <div ref={completedScrollRef} className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {completedTasks.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px] text-slate-400 text-center px-3">
              {t('Tasks hierher ziehen, um sie als erledigt abzulegen')}
            </div>
          ) : (
            completedTasks.map((task, index) => (
              <React.Fragment key={task.id}>
                {completedDateKeys[index] !== completedDateKeys[index - 1] && (
                  <DateLayerLine
                    dateKey={completedDateKeys[index]}
                    {...formatDateHeading(completedDateKeys[index], now)}
                    isDropActive={false}
                    className="pt-3 pb-1"
                  />
                )}
                <div
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-xs shadow-2xs"
                >
                  <div className="truncate min-w-0">
                    <span className="font-mono text-[11px] text-slate-400 mr-1.5">
                      {task.id}
                    </span>
                    <span className="line-through text-slate-500">{task.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReopenTask(task.id)}
                    title={t('Task wieder öffnen')}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-600 shrink-0"
                  >
                    {t('Öffnen')}
                  </button>
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
