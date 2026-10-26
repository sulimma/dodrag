import React, { useLayoutEffect, useRef } from 'react';
import { Calendar, CalendarClock, CheckCircle2 } from 'lucide-react';
import type { QuickResubmitTargetId } from '../domain/projector';
import { QUICK_RESUBMIT_TARGETS, formatDateHeading, toDateKey } from '../domain/projector';
import type { TaskState } from '../domain/types';
import type { TaskDragDropActions, TaskViewInteractions } from './taskInteractions';
import { taskDragSourceInteractions, draggedTaskIdOf } from './taskInteractions';
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
    | 'onDragStartTask'
    | 'onAddPredecessor'
    | 'onRemoveDependencyBetween'
    | 'onContextMenuTask'
    | 'onSelectTask'
  >;
  onCompleteTask: (id: string, fromDrag?: boolean) => void;
  onResubmitTasks: (id: string, target: QuickResubmitTargetId, fromDrag?: boolean) => void;
}
export function TaskSidebar({
  tasks,
  completedTasks,
  now,
  interactions,
  onResubmitTasks,
  onCompleteTask,
}: TaskSidebarProps) {
  const {
    selectedTaskId,
    activeDropTargetKey,
    draggedTaskId,
    setActiveDropTargetKey,
  } = interactions;
  const dragDropActions: TaskDragDropActions = interactions;
  const completedScrollRef = useRef<HTMLDivElement>(null);
  const completedEndVisible = useRef(true);
  const completionKey = JSON.stringify(completedTasks.map(task => [task.id, task.completedAt]));
  useLayoutEffect(() => {
    const container = completedScrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
    completedEndVisible.current = true;
  }, [completionKey]);
  useLayoutEffect(() => {
    const container = completedScrollRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let previousHeight = container.clientHeight;
    const endVisible = () => container.scrollHeight - container.clientHeight - container.scrollTop <= 1;
    const onScroll = () => {
      // A resize can emit scroll before ResizeObserver; preserve the pre-resize anchor.
      if (container.clientHeight === previousHeight) completedEndVisible.current = endVisible();
    };
    const observer = new ResizeObserver(() => {
      if (container.clientHeight === previousHeight) return;
      if (completedEndVisible.current) {
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      }
      previousHeight = container.clientHeight;
      completedEndVisible.current = endVisible();
    });
    container.addEventListener('scroll', onScroll);
    observer.observe(container);
    return () => {
      container.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);
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
                data-task-drop-target={targetKey}
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
                  const tId = draggedTaskIdOf(e, draggedTaskId);
                  if (tId && tasks[tId]) {
                    onResubmitTasks(tId, target.id, true);
                  }
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
        data-task-drop-target="completed-list-dropzone"
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
          const tId = draggedTaskIdOf(e, draggedTaskId);
          if (tId) {
            onCompleteTask(tId, true);
          }
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
                  {...taskDragSourceInteractions(task.id, dragDropActions)}
                  data-completed-task={task.id}
                  data-source-task-id={task.id}
                  data-task-selected={interactions.selectedTaskId === task.id ? 'true' : undefined}
                  tabIndex={0}
                  onFocus={() => {
                    if (interactions.selectedTaskId !== task.id) interactions.onSelectTask(task.id, { ctrlKey: false, metaKey: false, shiftKey: false }, completedTasks.map(task => task.id));
                  }}
                  onClick={(event) => {
                    if (interactions.selectedTaskId !== task.id || event.ctrlKey || event.metaKey || event.shiftKey)
                      interactions.onSelectTask(task.id, event, completedTasks.map(task => task.id));
                  }}
                  onContextMenu={(event) => interactions.onContextMenuTask(event, task.id)}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-xs shadow-2xs cursor-pointer hover:border-slate-300 transition-colors ${
                    draggedTaskId === task.id ? 'opacity-40' : ''
                  } ${
                    interactions.selectedTaskId === task.id ? 'ring-1 ring-sky-400' : ''
                  }`}
                >
                  <div className="truncate min-w-0">
                    <span className="font-mono text-[11px] text-slate-400 mr-1.5">
                      {task.id}
                    </span>
                    <span
                      data-task-selectable-text
                      className="line-through text-slate-500 cursor-text select-text"
                    >
                      {task.title}
                    </span>
                  </div>
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
