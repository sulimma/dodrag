import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eventBridge } from './bridge/eventBridge';
import { GanttView } from './components/GanttView';
import { ListView } from './components/ListView';
import { NetworkPlanView } from './components/NetworkPlanView';
import { MiniCornerView } from './components/MiniCornerView';
import { SettingsModal } from './components/SettingsModal';
import { AppToolbar, type ViewMode } from './components/AppToolbar';
import { TaskSidebar } from './components/TaskSidebar';
import { TaskContextMenu } from './components/TaskContextMenu';
import { ShortcutHelp } from './components/ShortcutHelp';
import { Toasts } from './components/Toasts';
import { DependencyHighlightIndicators } from './components/DependencyHighlightIndicators';
import type { TaskViewInteractions } from './components/taskInteractions';
import {
  computeDependencyHighlights,
  computeMiniWindowTasks,
  projectEvents,
} from './domain/projector';
import { normalizeTitleInput } from './domain/input';
import { previewPathKeys } from './domain/dependencyPaths';
import { useToasts } from './hooks/useToasts';
import { useDatabaseSnapshot } from './hooks/useDatabaseSnapshot';
import { useInlineEditors } from './hooks/useInlineEditors';
import { useTaskSelection } from './hooks/useTaskSelection';
import { useTaskDrag } from './hooks/useTaskDrag';
import type { DragIdentity } from './hooks/useTaskDrag';
import { useTaskMutations } from './hooks/useTaskMutations';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { t, useLanguage, errorText } from './i18n';

// Coordinates app state, shared task interactions, and the active view.
export function App() {
  const language = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLElement>(null);
  // The native drag identity survives drop render updates until dragend.
  const dragIdentity = useRef<DragIdentity | null>(null);
  const { toasts, pushToast } = useToasts();
  const selection = useTaskSelection();
  const database = useDatabaseSnapshot(pushToast, dragIdentity, () => {
    editors.cancelEdit();
    setNewTaskTitle('');
    selection.reset();
  });
  const {
    events,
    appSettings,
    showSettingsModal,
    setShowSettingsModal,
    snapshotReady,
    mutationBusy,
    confirmedEvents,
    mutate,
    loadSnapshot,
    changeDatabase,
  } = database;
  const state = useMemo(() => projectEvents(events, now), [events, now, language]);
  const editors = useInlineEditors(
    database,
    state.tasks,
    now,
    setLastMovedKey,
    () => selection.setContextMenu(null)
  );
  const { titleEditor, dateEditor, startInlineEdit } = editors;
  const drag = useTaskDrag(database, selection, state.tasks, dragIdentity);
  const actions = useTaskMutations(
    database,
    selection,
    state,
    now,
    dragIdentity,
    setLastMovedKey,
    pushToast
  );
  const {
    selectedTaskId,
    selectedTaskIds,
    selectedEdgeKeys,
    contextMenu,
    setContextMenu,
    setSelectedTaskId,
    clearEdgeSelection,
  } = selection;
  const { draggedTaskId, activeDropTargetKey, isAltDrag } = drag;
  useGlobalShortcuts({
    selection,
    drag,
    actions,
    state,
    showSettingsModal,
    showShortcutsModal,
    setShowShortcutsModal,
    isMiniMode,
    snapshotReady,
    listScrollRef,
    newTaskInputRef,
    startInlineEdit,
  });

  useEffect(() => {
    let current = true;
    mutationBusy.current = true;
    loadSnapshot(() => current)
      .then((s) => {
        if (!current) return;
        if (s.databaseReady && s.bootMinimized) {
          setIsMiniMode(true);
          eventBridge
            .enterMiniMode('', 4)
             .catch((error) => pushToast(errorText(t('Kompaktansicht konnte nicht geöffnet werden'), error), 'warning'));
        }
      })
      .catch((error) => {
        if (!current) return;
        pushToast(errorText(t('Anwendung konnte nicht geladen werden'), error), 'warning');
        setShowSettingsModal(true);
      })
      .finally(() => {
        if (current) mutationBusy.current = false;
      });
    const unsubMinimize = eventBridge.onWindowMinimized(() => {
      setIsMiniMode(true);
    });
    const unsubRestore = eventBridge.onWindowRestored(() => {
      setIsMiniMode(false);
    });
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      current = false;
      unsubMinimize();
      unsubRestore();
      clearInterval(interval);
    };
  }, []);
  const miniTasks = useMemo(
    () => computeMiniWindowTasks(state.openTasks, now),
    [state.openTasks, now]
  );

  useEffect(() => {
    eventBridge.updateMiniModeHeight(miniTasks.length);
  }, [miniTasks.length]);

  const highlights = useMemo(
    () => {
      const roles = computeDependencyHighlights(selectedTaskId, state.tasks);
      for (const id of selectedTaskIds) roles[id] = 'selected';
      return roles;
    },
    [selectedTaskId, selectedTaskIds, state.tasks]
  );
  const deletionPreview = previewPathKeys(
    state.tasks,
    draggedTaskId,
    activeDropTargetKey,
    isAltDrag
  );
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = normalizeTitleInput(newTaskTitle).trim();
    if (!trimmed) return;

    if (mutationBusy.current) return;
    const taskId = projectEvents(
      confirmedEvents.current,
      new Date()
    ).nextTaskId;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() =>
      eventBridge.appendEvent('TASK_CREATED', {
        taskId,
        title: trimmed,
        configuredStart: now.toISOString(),
        createdAt: now.toISOString(),
      })
    );
    if (!updated) return;
    setNewTaskTitle((current) => (current.trim() === trimmed ? '' : current));
    setSelectedTaskId(taskId);
  };
  const handleEnterMiniMode = async () => {
    setIsMiniMode(true);
    await eventBridge.enterMiniMode('', miniTasks.length);
  };

  const handleRestoreFromMiniMode = async (selectTaskId?: string) => {
    setIsMiniMode(false);
    if (selectTaskId) {
      setSelectedTaskId(selectTaskId);
      clearEdgeSelection();
    }
    await eventBridge.exitMiniMode();
  };

  // One contract instance supplies identical selection/context/Alt behavior to every layout.
  const interactions: TaskViewInteractions = {
    selectedTaskId,
    selectedTaskIds,
    orderedTaskIds: state.listEntries.flatMap(entry => entry.kind === 'task' ? [entry.task.id] : []),
    selectedEdgeKeys,
    highlights,
    deletionPreview,
    onSelectTask: selection.onSelectTask,
    onContextMenuTask: selection.onContextMenuTask,
    onSelectEdge: selection.onSelectEdge,
    onClearEdgeSelection: clearEdgeSelection,
    onClearTaskSelection: () => setSelectedTaskId(null),
    ...drag,
    onAddPredecessor: actions.handleAddPredecessor,
    onRemoveDependencyBetween: actions.handleRemoveDependencyBetween,
    onSetConfiguredDate: (id, date, label) => actions.handleSetConfiguredDate(id, date, label, true),
    onToggleActive: actions.handleToggleActive,
  };
  if (isMiniMode) {
    return (
      <MiniCornerView
        tasks={miniTasks}
        onSelectAndRestore={(taskId) => handleRestoreFromMiniMode(taskId)}
        onRestoreWindow={() => handleRestoreFromMiniMode()}
        onResubmitTasks={actions.handleResubmitTasks}
        onCompleteTask={actions.handleCompleteTask}
        onToggleActive={actions.handleToggleActive}
      />
    );
  }
  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 overflow-hidden">
      <AppToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        nextTaskId={state.nextTaskId}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        snapshotReady={snapshotReady}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        newTaskInputRef={newTaskInputRef}
        onCreateTask={handleCreateTask}
        onUndo={actions.handleUndo}
        onRedo={actions.handleRedo}
        onSettings={database.openSettings}
        onMiniMode={handleEnterMiniMode}
        onHelp={() => setShowShortcutsModal(true)}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="relative flex flex-1 min-w-0 overflow-hidden">
          <main
            ref={listScrollRef}
            className={`flex-1 overflow-y-auto overflow-x-auto ${viewMode === 'gantt' ? '' : 'px-6 py-5'}`}
            onClick={(e) => {
              if (
                (e.target as HTMLElement).closest(
                  '[data-task-drag], [data-edge-key], button, input, textarea, [contenteditable="true"]'
                )
              )
                return;
              setSelectedTaskId(null);
              clearEdgeSelection();
            }}
          >
            {viewMode === 'list' ? (
              <ListView
                {...interactions}
                listEntries={state.listEntries}
                movedItemKey={lastMovedKey}
                titleEditor={titleEditor}
                dateEditor={dateEditor}
              />
            ) : viewMode === 'network' ? (
              <NetworkPlanView
                {...interactions}
                openTasks={state.openTasks}
                now={now}
                titleEditor={titleEditor}
                dateEditor={dateEditor}
              />
            ) : (
              <GanttView
                {...interactions}
                openTasks={state.openTasks}
                listEntries={state.listEntries}
                now={now}
                titleEditor={titleEditor}
              />
            )}
          </main>
          <DependencyHighlightIndicators
            key={viewMode}
            scrollRef={listScrollRef}
            contentKey={highlights}
            horizontal={viewMode === 'gantt'}
          />
        </div>
        <TaskSidebar
          tasks={state.tasks}
          completedTasks={state.completedTasks}
          now={now}
          interactions={interactions}
          onResubmitTasks={actions.handleResubmitTasks}
          onCompleteTask={actions.handleCompleteTask}
          onReopenTask={actions.handleReopenTask}
        />
      </div>
      {contextMenu && state.tasks[contextMenu.taskId] && (
        <TaskContextMenu
          contextMenu={contextMenu}
          task={state.tasks[contextMenu.taskId]}
          selectedTaskIds={selectedTaskIds}
          onClose={() => setContextMenu(null)}
          onToggleActive={actions.handleToggleActive}
          onEditTitle={startInlineEdit}
          onSetConfiguredDate={actions.handleSetConfiguredDate}
          onRemovePredecessor={actions.handleRemovePredecessor}
          onCompleteTask={actions.handleCompleteTask}
        />
      )}
      <ShortcutHelp
        open={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
      {showSettingsModal && (
        <SettingsModal
          settings={{
            ...(appSettings || {
              knownDatabases: [],
              activeDatabasePath: '',
              autostart: false,
            }),
            databaseReady: snapshotReady,
          }}
          onClose={database.handleCloseSettingsModal}
          onReloadDatabase={async () => {
            await changeDatabase(() => eventBridge.getSettings());
          }}
          onSelectFolder={() => eventBridge.selectFolderDialog()}
          onCreateDatabase={database.handleCreateDatabase}
          onOpenExistingDatabase={database.handleOpenExistingDatabase}
          onSwitchDatabase={database.handleSwitchDatabase}
          onDeleteDatabase={database.handleDeleteDatabase}
          onToggleAutostart={database.handleToggleAutostart}
          onSetUILanguage={database.handleSetUILanguage}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
