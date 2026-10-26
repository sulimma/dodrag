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
import { TaskDetailPanel } from './components/TaskDetailPanel';
import type { InlineEditor } from './components/inlineEditor';
import { ShortcutHelp, type HelpPage } from './components/ShortcutHelp';
import { Toasts } from './components/Toasts';
import { DependencyHighlightIndicators } from './components/DependencyHighlightIndicators';
import type { TaskViewInteractions } from './components/taskInteractions';
import { draggedTaskIdOf } from './components/taskInteractions';
import {
  computeDependencyHighlights,
  computeMiniWindowTasks,
  dateKeyToIsoStart,
  projectEvents,
  toDateKey,
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
import { useSourceDrop } from './hooks/useSourceDrop';
import { appendTaskSources } from './domain/taskSources';
import type { EditorTarget } from './components/editor/types';

// Coordinates app state, shared task interactions, and the active view.
export function App() {
  const language = useLanguage();
  const [now, setNow] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const pendingSource = useRef<EditorTarget | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [helpPage, setHelpPage] = useState<HelpPage>('shortcuts');
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [editOwner, setEditOwner] = useState<'view' | 'detail'>('view');
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLElement>(null);
  // Frozen drag members/database remain available until drop callbacks consume them.
  const dragIdentity = useRef<DragIdentity | null>(null);
  const { toasts, pushToast } = useToasts();
  const selection = useTaskSelection();
  const database = useDatabaseSnapshot(pushToast, dragIdentity, () => {
    editors.cancelEdit();
    setNewTaskTitle('');
    pendingSource.current = null;
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
  const scopedEditor = (editor: InlineEditor, owner: 'view' | 'detail'): InlineEditor => ({
    ...editor,
    taskId: editOwner === owner ? editor.taskId : null,
    onStart: task => { setEditOwner(owner); editor.onStart(task); },
  });
  // A single editing session has one visible input, not two competing autofocus effects.
  const titleEditor = scopedEditor(editors.titleEditor, 'view');
  const dateEditor = scopedEditor(editors.dateEditor, 'view');
  const drag = useTaskDrag(database, selection, state.tasks, dragIdentity);
  const actions = useTaskMutations(
    database,
    selection,
    state,
    now,
    dragIdentity,
    setLastMovedKey,
    pushToast,
    setNow
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
  const { draggedTaskId, activeDropTargetKey, isAltDrag, setActiveDropTargetKey } = drag;
  useSourceDrop(actions.handleAppendSources, error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning'));
  const miniTasks = useMemo(
    () => computeMiniWindowTasks(state.openTasks, now),
    [state.openTasks, now]
  );
  useGlobalShortcuts({
    selection,
    actions,
    state,
    showSettingsModal,
    showShortcutsModal,
    setShowShortcutsModal: open => { if (open === true) setHelpPage('shortcuts'); setShowShortcutsModal(open); },
    isMiniMode,
    miniTaskIds: miniTasks.map(task => task.id),
    snapshotReady,
    listScrollRef,
    newTaskInputRef,
    startInlineEdit: task => {
      setEditOwner(isDetailPanelOpen && document.activeElement?.closest('[data-task-detail-panel]') ? 'detail' : 'view');
      editors.startInlineEdit(task);
    },
    onMinimize: () => {
      if (!isMiniMode) handleEnterMiniMode().catch(error =>
        pushToast(errorText(t('Kompaktansicht konnte nicht geöffnet werden'), error), 'warning'));
    },
    onRestore: () => {
      if (isMiniMode) handleRestoreFromMiniMode().catch(error =>
        pushToast(errorText(t('Fenster wiederherstellen'), error), 'warning'));
    },
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
      setContextMenu(null);
      setIsMiniMode(true);
    });
    const unsubRestore = eventBridge.onWindowRestored(() => {
      setIsMiniMode(false);
    });
    const unsubCacheWarning = eventBridge.onPreviewCacheWarning(message => pushToast(message, 'warning'));
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      current = false;
      unsubMinimize();
      unsubRestore();
      unsubCacheWarning();
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    // Never let invisible main-view task/edge selections drive compact actions.
    if (isMiniMode) {
      setSelectedTaskId(null);
      clearEdgeSelection();
    }
  }, [isMiniMode]);

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
    const source = pendingSource.current;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() =>
      eventBridge.appendBatch([
        { type: 'TASK_CREATED', payload: {
          taskId, title: trimmed, configuredStart: now.toISOString(), createdAt: now.toISOString(),
        } },
        ...(source ? [{ type: 'TASK_DESCRIPTION_SET' as const,
          payload: { taskId, description: appendTaskSources('', [source]) } }] : []),
      ])
    );
    if (!updated) return;
    if (pendingSource.current === source) pendingSource.current = null;
    setNewTaskTitle((current) => (current.trim() === trimmed ? '' : current));
    setSelectedTaskId(taskId);
  };
  const handleCreateSourceTask = (source: EditorTarget) => {
    pendingSource.current = source;
    newTaskInputRef.current?.focus();
  };
  const handleEnterMiniMode = async () => {
    setContextMenu(null);
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
  const taskContextMenu = contextMenu && state.tasks[contextMenu.taskId] && (
    <TaskContextMenu
      contextMenu={contextMenu}
      task={state.tasks[contextMenu.taskId]}
      databaseKey={appSettings?.activeDatabasePath ?? ''}
      onClose={() => setContextMenu(null)}
      onToggleActive={actions.handleToggleActive}
      onSetConfiguredDate={actions.handleSetConfiguredDate}
      onRemovePredecessor={actions.handleRemovePredecessor}
      onCompleteTask={actions.handleCompleteTask}
      onReopenTask={actions.handleReopenTask}
      onError={(error) => pushToast(errorText(t('Kontextmenü konnte nicht geöffnet werden'), error), 'warning')}
    />
  );
  if (isMiniMode) {
    return (
      <>
        <MiniCornerView
          tasks={miniTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          listScrollRef={listScrollRef as React.RefObject<HTMLDivElement>}
          onSelectAndRestore={(taskId) => handleRestoreFromMiniMode(taskId)}
          onRestoreWindow={() => handleRestoreFromMiniMode()}
          onResubmitTasks={actions.handleResubmitTasks}
          onCompleteTask={actions.handleCompleteTask}
          onToggleActive={actions.handleToggleActive}
          onContextMenuTask={(event, id) => {
            setSelectedTaskId(id);
            selection.onContextMenuTask(event, id);
          }}
          titleEditor={titleEditor}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          newTaskInputRef={newTaskInputRef}
          snapshotReady={snapshotReady}
          onCreateTask={handleCreateTask}
        />
        {taskContextMenu}
        <ShortcutHelp open={showShortcutsModal} initialPage={helpPage} onClose={() => setShowShortcutsModal(false)} />
        <Toasts toasts={toasts} />
      </>
    );
  }
  const listBackgroundKey = 'list-background';
  const todayKey = toDateKey(now);
  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 overflow-hidden">
      <AppToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        nextTaskId={state.nextTaskId}
        openTaskCount={state.openTasks.length}
        openTaskDelta={state.openTasks.length - state.openTaskCountAtYesterdayEnd}
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
        onHelp={() => { setHelpPage('shortcuts'); setShowShortcutsModal(true); }}
      />
      <div className="flex-1 flex overflow-hidden">
        <TaskDetailPanel
          open={isDetailPanelOpen}
          onToggle={() => setIsDetailPanelOpen(open => !open)}
          onSyntaxHelp={() => { setHelpPage('syntax'); setShowShortcutsModal(true); }}
          key={appSettings?.activeDatabasePath ?? ''}
          task={selectedTaskId ? state.tasks[selectedTaskId] ?? null : null}
          interactions={interactions} titleEditor={scopedEditor(editors.titleEditor, 'detail')} dateEditor={scopedEditor(editors.dateEditor, 'detail')}
          onClose={() => setIsDetailPanelOpen(false)}
          onToggleActive={actions.handleToggleActive}
          onCompleteTask={actions.handleCompleteTask} onReopenTask={actions.handleReopenTask}
          onSetConfiguredDate={actions.handleSetConfiguredDate} onRemovePredecessor={actions.handleRemovePredecessor}
          onDescriptionChange={async (taskId, description, groupId) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_DESCRIPTION_SET', { taskId, description }, groupId));
            if (!result) throw new Error(t('Beschreibung konnte nicht gespeichert werden'));
          }}
          onAddLog={async (taskId, text) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_LOG_ADDED', {
              taskId, entryId: crypto.randomUUID(), text, createdAt: new Date().toISOString(),
            }));
            if (!result) throw new Error(t('Log-Eintrag konnte nicht gespeichert werden'));
          }}
          onRemoveLog={async (taskId, entryId) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_LOG_REMOVED', { taskId, entryId }));
            if (!result) throw new Error(t('Änderung konnte nicht gespeichert werden'));
          }}
          onCreateSourceTask={handleCreateSourceTask}
          onError={error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning')}
        />
        <div className="relative flex flex-1 min-w-0 overflow-hidden">
          <main
            ref={listScrollRef}
            data-task-drop-target={viewMode === 'list' ? listBackgroundKey : undefined}
            onDragOver={viewMode === 'list' ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (draggedTaskId) {
                event.dataTransfer.dropEffect = 'move';
                setActiveDropTargetKey(listBackgroundKey);
              }
            } : undefined}
            onDragLeave={viewMode === 'list' ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setActiveDropTargetKey(null);
            } : undefined}
            onDrop={viewMode === 'list' ? (event) => {
              event.preventDefault();
              if (event.dataTransfer?.types?.includes('Files')) return;
              event.stopPropagation();
              const taskId = draggedTaskIdOf(event, draggedTaskId);
              if (taskId && state.tasks[taskId])
                actions.handleSetConfiguredDate(taskId, dateKeyToIsoStart(todayKey), todayKey, true);
            } : undefined}
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
        />
      </div>
      {taskContextMenu}
      <ShortcutHelp
        open={showShortcutsModal}
        initialPage={helpPage}
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
          onRunSetupAction={database.handleRunSetupAction}
          onOpenFolderInExplorer={(path, isFile) => eventBridge.openFolderInExplorer(path, isFile)}
          onOpenFolderInVSCode={(path, isFile) => eventBridge.openFolderInVSCode(path, isFile)}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}
