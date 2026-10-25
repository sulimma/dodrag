import React from 'react';
import { Flame, CornerDownRight } from 'lucide-react';
import type { HighlightRole, ListEntry } from '../domain/types';
import { DateLayerLine } from './DateLayerLine';
import { SmoothFlipList } from './SmoothFlipList';
import { TaskTitle } from './TaskTitle';
import type { InlineEditor } from './inlineEditor';
import { TaskDate } from './TaskDate';
import { TaskDragHandle } from './TaskDragHandle';
import { TaskChecklistBadge } from './TaskChecklistBadge';
import { taskInteractions, draggedTaskIdOf } from './taskInteractions';
import type { TaskViewInteractions } from './taskInteractions';
import { taskAppearanceRole } from './taskAppearance';
import { t } from '../i18n';
interface ListViewProps extends TaskViewInteractions {
  listEntries: ListEntry[];
  movedItemKey: string | null;
  titleEditor: InlineEditor;
  dateEditor: InlineEditor;
}
// Renders the date-layered task list and its shared drag interactions.
export function ListView(props: ListViewProps) {
  const {
    listEntries,
    movedItemKey,
    titleEditor,
    dateEditor,
    highlights,
    draggedTaskId,
    activeDropTargetKey,
    isAltDrag,
    setActiveDropTargetKey,
    onSetConfiguredDate,
    onToggleActive,
    deletionPreview,
    selectedEdgeKeys,
    onSelectEdge,
  } = props;
  const listOrderedEdgeKeys = listEntries.flatMap((entry) =>
    entry.kind === 'task'
      ? entry.task.predecessorIds.map((id) => `${id}->${entry.task.id}`)
      : []
  );
  return (
    <SmoothFlipList
      movedItemKey={movedItemKey}
      className="w-full space-y-2 pb-16"
    >
      {listEntries.map((entry) => {
        if (entry.kind === 'date') {
          const isDropActive = activeDropTargetKey === entry.key;
          return (
            <DateLayerLine
              key={entry.key}
              dataFlipKey={entry.key}
              dateKey={entry.dateKey}
              weekdayShort={entry.weekdayShort}
              isWeekend={entry.isWeekend}
              isToday={entry.isToday}
              isDropActive={isDropActive}
              className="pt-3 pb-1"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                if (activeDropTargetKey !== entry.key) {
                  setActiveDropTargetKey(entry.key);
                }
              }}
              onDragLeave={() => {
                if (activeDropTargetKey === entry.key) {
                  setActiveDropTargetKey(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const tId = draggedTaskIdOf(e, draggedTaskId);
                if (tId) {
                  onSetConfiguredDate(tId, entry.isoDate, entry.dateKey);
                }
              }}
            />
          );
        }

        // Task Row
        const task = entry.task;
        const role: HighlightRole = highlights[task.id] ?? null;
        const isBeingDragged = draggedTaskId === task.id;
        const isDropTarget =
          activeDropTargetKey === entry.key && draggedTaskId !== task.id;
        const isEditing = titleEditor.taskId === task.id;
        const isEditingDate = dateEditor.taskId === task.id;

        const appearance = taskAppearanceRole(
          task,
          role,
          isDropTarget,
          isAltDrag
        );
        let containerClasses =
          'bg-white border-slate-200/90 shadow-sm hover:border-slate-300';

        if (appearance === 'drop') {
          containerClasses =
            'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-md';
        } else if (appearance === 'selected') {
          containerClasses =
            'bg-sky-100/90 border-sky-500 ring-2 ring-sky-400/35 shadow-sm';
        } else if (appearance === 'predecessor') {
          containerClasses =
            'bg-amber-100/85 border-amber-500 ring-2 ring-amber-400/30 shadow-sm';
        } else if (appearance === 'successor') {
          containerClasses =
            'bg-purple-100/85 border-purple-500 ring-2 ring-purple-400/30 shadow-sm';
        } else if (appearance === 'active') {
          containerClasses =
            'bg-emerald-100/90 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm';
        } else if (appearance === 'deemphasized') {
          containerClasses =
            'bg-white/60 border-slate-200/60 opacity-80 hover:opacity-100';
        }

        return (
          <div
            key={entry.key}
            data-flip-key={entry.key}
            data-dependency-highlight={
              role?.startsWith('predecessor-')
                ? 'predecessor'
                : role?.startsWith('successor-')
                  ? 'successor'
                  : undefined
            }
            {...taskInteractions(task.id, entry.key, props)}
            data-task-drag-disabled={isEditing || isEditingDate || undefined}
            className={`group relative flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-colors cursor-pointer ${containerClasses} ${
              isBeingDragged ? 'opacity-35' : ''
            }`}
          >
            {/* Left section: Drag Handle + Active Toggle + Task ID + In-place Editable Title */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div
                title={t('Ziehen auf Task (= Vorgänger setzen), Alt-Ziehen (= Kante löschen), auf Datum oder Wiedervorlage rechts')}
                className="text-slate-400 group-hover:text-slate-600 cursor-grab active:cursor-grabbing"
              >
                <TaskDragHandle />
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive(task);
                }}
                title={
                  task.isActive
                    ? t('Deaktivieren (Space)')
                    : t('Aktivieren (Space)')
                }
                className={`p-1 rounded-lg border transition-all ${
                  task.isActive
                    ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-100 border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-300'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
              </button>

              <span
                className={`font-mono text-xs px-2 py-0.5 rounded-md border shrink-0 ${
                  task.isActive
                    ? 'bg-emerald-200/70 border-emerald-400 text-emerald-900 font-semibold'
                    : role === 'selected'
                      ? 'bg-sky-200/70 border-sky-400 text-sky-950 font-semibold'
                      : 'bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                {task.id}
              </span>

              <div className="min-w-0 flex-1" data-task-title-area>
                <TaskTitle
                  task={task}
                  editor={titleEditor}
                  className="inline-block max-w-full align-middle text-sm truncate"
                />
              </div>
            </div>

            {/* Right section: Selectable Predecessor chips (Ctrl/Shift multi-select, Del/Backspace) & In-Place Editable Configured Date */}
            <div className="flex items-center gap-2 shrink-0">
              <TaskChecklistBadge progress={task.checklistProgress} />
              {task.predecessorIds.length > 0 && (
                <div className="flex items-center gap-1">
                  {task.allPredecessorIds
                    .filter(
                      (predId) =>
                        task.predecessorIds.includes(predId) ||
                        deletionPreview.includes(`${predId}->${task.id}`)
                    )
                    .map((predId) => {
                      const edgeKey = `${predId}->${task.id}`;
                      const isChipSelected = draggedTaskId
                        ? deletionPreview.includes(edgeKey)
                        : selectedEdgeKeys.includes(edgeKey);
                      return (
                        <button
                          key={predId}
                          data-edge-key={edgeKey}
                          data-deletion-preview={
                            deletionPreview.includes(edgeKey) || undefined
                          }
                          type="button"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEdge(edgeKey, e, listOrderedEdgeKeys);
                          }}
                          title={t('Vorgänger {id} (Klick / Strg+Klick / Shift+Klick zum Auswählen, Entf/Backspace zum Löschen)', { id: predId })}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer ${
                            isChipSelected
                              ? 'bg-rose-100 text-rose-900 border-rose-500 ring-2 ring-rose-400/40 font-semibold shadow-xs'
                              : 'bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-400 hover:bg-amber-100/70'
                          }`}
                        >
                          <CornerDownRight
                            className={`w-3 h-3 ${
                              isChipSelected
                                ? 'text-rose-600'
                                : 'text-amber-600'
                            }`}
                          />
                          {predId}
                        </button>
                      );
                    })}
                </div>
              )}

              <TaskDate task={task} editor={dateEditor} />
            </div>
          </div>
        );
      })}
    </SmoothFlipList>
  );
}
