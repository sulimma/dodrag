import { useWindowPresentation } from './hooks/useWindowPresentation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eventBridge, type WindowMode } from './bridge/eventBridge';
import { GanttView } from './components/GanttView';
import { ListView } from './components/ListView';
import { NetworkPlanView } from './components/NetworkPlanView';
import { MiniCornerView } from './components/MiniCornerView';
import { SettingsModal } from './components/SettingsModal';
import { AppTitleBar } from './components/AppTitleBar';
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
import { useDescriptionDrafts } from './hooks/useDescriptionDrafts';
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
  const [windowMode, setWindowMode] = useState<WindowMode>('window');
  const [startupComplete, setStartupComplete] = useState(false);
  const suspendPresentation = useWindowPresentation(startupComplete, windowMode);
  const isMiniMode = windowMode === 'mini';
  const confirmedMode = useRef<WindowMode | null>(null);
  const modeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const requestModeRef = useRef<(mode: WindowMode, automatic?: boolean, expectedMode?: WindowMode) => void>(() => {});
  const modeVersion = useRef(0);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [editOwner, setEditOwner] = useState<'view' | 'detail'>('view');
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLElement>(null);
  // Frozen drag members/database remain available until drop callbacks consume them.
  const dragIdentity = useRef<DragIdentity | null>(null);
  const { toasts, pushToast } = useToasts();
  const selection = useTaskSelection();
  const flushDescriptions = useRef<() => Promise<boolean>>(async () => true);
  const descriptionSaving = useRef<() => boolean>(() => false);
  const database = useDatabaseSnapshot(pushToast, dragIdentity, () => {
    editors.cancelEdit();
    setNewTaskTitle('');
    pendingSource.current = null;
    selection.reset();
  }, () => flushDescriptions.current(), () => descriptionSaving.current());
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
  const descriptions = useDescriptionDrafts(database);
  flushDescriptions.current = descriptions.flushAll;
  descriptionSaving.current = descriptions.hasPending;
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
    onStart: task => { setSelectedTaskId(task.id); setEditOwner(owner); editor.onStart(task); },
  });
  // A single editing session has one visible input, not two competing autofocus effects.
  const titleEditor = scopedEditor(editors.titleEditor, 'view');
  const dateEditor = scopedEditor(editors.dateEditor, 'view');
  const activeInlineEditor = useRef(false);
  activeInlineEditor.current = Boolean(editors.titleEditor.taskId || editors.dateEditor.taskId);
  const drag = useTaskDrag(database, selection, state.tasks, dragIdentity);
  const actions = useTaskMutations(
    database,
    selection,
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
  useSourceDrop(async (taskId, sources) => {
    const ids = selectedTaskIds.includes(taskId) ? selectedTaskIds : [taskId];
    await descriptions.appendSources(ids, sources);
  }, error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning'));
  const historyActions = {
    ...actions,
    handleUndo: async () => { if (await descriptions.flushAll()) await actions.handleUndo(); },
    handleRedo: async () => { if (await descriptions.flushAll()) await actions.handleRedo(); },
  };
  const miniTasks = useMemo(
    () => computeMiniWindowTasks(state.openTasks, now),
    [state.openTasks, now]
  );
  useGlobalShortcuts({
    selection,
    actions: historyActions,
    state,
    showSettingsModal,
    showShortcutsModal,
    setShowShortcutsModal: open => { if (open === true) setHelpPage('shortcuts'); setShowShortcutsModal(open); },
    isMiniMode,
    miniTaskIds: miniTasks.map(task => task.id),
    snapshotReady,
    listScrollRef,
    newTaskInputRef,
    onSettings: () => { if (isMiniMode) void handleRestoreFromMiniMode().then(ok => { if (ok) database.openSettings(); }); else database.openSettings(); },
    onOpenMiniTask: id => { void handleRestoreFromMiniMode(id); },
    onViewChange: setViewMode,
    onToggleDetails: () => {
      if (isDetailPanelOpen && document.activeElement?.closest('[data-task-detail-panel]')) listScrollRef.current?.focus();
      setIsDetailPanelOpen(open => !open);
    },
    startInlineEdit: task => {
      setEditOwner(isDetailPanelOpen && document.activeElement?.closest('[data-task-detail-panel]') ? 'detail' : 'view');
      editors.startInlineEdit(task);
    },
    onMinimize: () => { void requestWindowMode('mini'); },
    onRestore: () => { void requestWindowMode('window'); },
  });

  useEffect(() => {
    let current = true;
    mutationBusy.current = true;
    const version = modeVersion.current;
    const initialMode = eventBridge.getWindowMode().then(mode => {
      if (current && modeVersion.current === version) { confirmedMode.current = mode; setWindowMode(mode); }
    }).catch(error => pushToast(errorText(t('Anwendung konnte nicht geladen werden'), error), 'warning'));
    loadSnapshot(() => current)
      .then(async settings => {
        await initialMode;
        if (!current) return;
        // Register the final task count before applying compact geometry.
        await eventBridge.updateMiniModeHeight(computeMiniWindowTasks(projectEvents(confirmedEvents.current, new Date()).openTasks, new Date()).length);
        if (current && settings.databaseReady && settings.bootMinimized) await requestWindowMode('mini', true);
      })
      .catch((error) => {
        if (!current) return;
        pushToast(errorText(t('Anwendung konnte nicht geladen werden'), error), 'warning');
        setShowSettingsModal(true);
      })
      .finally(() => { if (current) { mutationBusy.current = false; setStartupComplete(true); } });
    const unsubMode = eventBridge.onWindowModeChanged(mode => {
      modeVersion.current++;
      confirmedMode.current = mode;
      setWindowMode(mode);
    });
    const unsubRequest = eventBridge.onWindowModeRequested((mode, automatic, expectedMode) => requestModeRef.current(mode, automatic ?? false, expectedMode));

    const unsubCacheWarning = eventBridge.onPreviewCacheWarning(message => pushToast(message, 'warning'));
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      current = false;
      unsubMode();
      unsubRequest();
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
    void eventBridge.updateMiniModeHeight(miniTasks.length);
  }, [miniTasks.length]);
  useEffect(() => {
    // React may remove an editor without firing blur (selection, collapse, mini).
    const taskId = isDetailPanelOpen && !isMiniMode ? selectedTaskId : null;
    return () => { if (taskId) void descriptions.flush(taskId); };
  }, [selectedTaskId, isDetailPanelOpen, isMiniMode]);
  useEffect(() => {
    let closing = false;
    const previousInert = document.body.inert;
    const unsubscribe = eventBridge.onBeforeClose(() => {
      if (closing) return;
      closing = true;
      // No user input may create another draft between final flush and native
      // close approval. Restore interaction if saving fails; no extra dialog.
      document.body.inert = true;
      void flushDescriptions.current().then(async saved => {
        if (!saved) { closing = false; document.body.inert = previousInert; }
        await eventBridge.finishClose(saved);
      }).catch(async error => {
        closing = false; document.body.inert = previousInert;
        pushToast(errorText(t('Beschreibung konnte nicht gespeichert werden'), error), 'warning');
        try { await eventBridge.finishClose(false); } catch { /* Native host is already unavailable. */ }
      });
    });
    // Subscribe before native closing starts waiting for our acknowledgement.
    void eventBridge.setEditorReady(true).catch(error => pushToast(errorText(t('Anwendung konnte nicht geladen werden'), error), 'warning'));
    return () => {
      unsubscribe();
      document.body.inert = previousInert;
      void eventBridge.setEditorReady(false).catch(() => {});
    };
  }, []);

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
  // Queue genuine requests; only native confirmations change the rendered mode.
  const requestWindowMode = (mode: WindowMode, automatic = false, expectedMode?: WindowMode): Promise<boolean> => {
    const operation = modeQueue.current.then(async () => {
      if (expectedMode !== undefined && confirmedMode.current !== expectedMode) return false;
      if (confirmedMode.current === mode) return true;
      if (automatic && mode === 'mini' && (showSettingsModal || showShortcutsModal || contextMenu ||
        editors.titleEditor.taskId || editors.dateEditor.taskId || descriptions.hasDrafts())) return false;
      if (mode === 'mini' || mode === 'taskbar') {
        if (!await descriptions.flushAll()) return false;
        // Blur may already be saving an inline draft. Never discard a failed or still-open editor.
        if (activeInlineEditor.current) return false;
      }
      const version = modeVersion.current;
      const finishPresentation = suspendPresentation();
      let confirmed: WindowMode;
      try { confirmed = await eventBridge.setWindowMode(mode); }
      finally { finishPresentation(); }
      if (modeVersion.current === version) { confirmedMode.current = confirmed; setWindowMode(confirmed); }
      if (confirmed === mode) {
        setContextMenu(null);
        setShowShortcutsModal(false);
        setShowSettingsModal(false);
      }
      return confirmed === mode;
    }).catch(error => {
      pushToast(errorText(t('Fenster wiederherstellen'), error), 'warning');
      return false;
    });
    modeQueue.current = operation;
    return operation;
  };
  requestModeRef.current = (mode, automatic, expectedMode) => { void requestWindowMode(mode, automatic, expectedMode); };
  const handleRestoreFromMiniMode = async (selectTaskId?: string) => {
    if (!await requestWindowMode('window')) return false;
    if (selectTaskId) {
      setSelectedTaskId(selectTaskId);
      clearEdgeSelection();
      setIsDetailPanelOpen(true);
    }
    return true;
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
          onSelectAndRestore={(taskId) => { void handleRestoreFromMiniMode(taskId); }}
          onRestoreWindow={() => { void handleRestoreFromMiniMode(); }}
          windowMode={windowMode}
          onWindowMode={mode => { void requestWindowMode(mode); }}
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
    <div className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 overflow-hidden"
      onDoubleClickCapture={event => {
        if (!(event.target instanceof Element) ||
          event.target.closest('input,textarea,button,a,select,[contenteditable="true"]')) return;
        const taskId = event.target.closest<HTMLElement>('[data-task-drag]')?.dataset.taskDrag;
        if (!taskId || !state.tasks[taskId]) return;
        // Only free task space toggles details; title text keeps native editing/selection.
        event.preventDefault(); event.stopPropagation();
        editors.cancelEdit(); setContextMenu(null); clearEdgeSelection();
        if (isDetailPanelOpen && document.activeElement?.closest('[data-task-detail-panel]')) listScrollRef.current?.focus();
        setSelectedTaskId(taskId); setIsDetailPanelOpen(open => !open);
      }}>
      <AppTitleBar onWindowMode={mode => { void requestWindowMode(mode); }}
        onError={error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning')} />
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
        onUndo={historyActions.handleUndo}
        onRedo={historyActions.handleRedo}
        onSettings={database.openSettings}
        onHelp={() => { setHelpPage('shortcuts'); setShowShortcutsModal(true); }}
      />
      <div className="flex-1 flex overflow-hidden">
        <TaskDetailPanel
          open={isDetailPanelOpen}
          onToggle={() => setIsDetailPanelOpen(open => !open)}
          onSyntaxHelp={() => { setHelpPage('syntax'); setShowShortcutsModal(true); }}
          key={appSettings?.activeDatabasePath ?? ''}
          task={descriptions.taskWithDraft(selectedTaskId ? state.tasks[selectedTaskId] ?? null : null)}
          interactions={interactions} titleEditor={scopedEditor(editors.titleEditor, 'detail')} dateEditor={scopedEditor(editors.dateEditor, 'detail')}
          onClose={() => setIsDetailPanelOpen(false)}
          onToggleActive={actions.handleToggleActive}
          onCompleteTask={actions.handleCompleteTask} onReopenTask={actions.handleReopenTask}
          onSetConfiguredDate={actions.handleSetConfiguredDate} onRemovePredecessor={actions.handleRemovePredecessor}
          onDescriptionChange={descriptions.change}
          onDescriptionCommit={taskId => { void descriptions.flush(taskId); }}
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
          onUpdateLog={async (taskId, entryId, text) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_LOG_UPDATED', { taskId, entryId, text }));
            if (!result) throw new Error(t('Log-Eintrag konnte nicht gespeichert werden'));
          }}
          onCreateSourceTask={handleCreateSourceTask}
          onError={error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning')}
        />
        <div className="relative flex flex-1 min-w-0 overflow-hidden">
          <main
            ref={listScrollRef}
            tabIndex={0} data-shortcut-region="1"
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
