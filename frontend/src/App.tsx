import { allowWindowPaint, useWindowPresentation } from './hooks/useWindowPresentation';
import { flushSync } from 'react-dom';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { eventBridge, type WindowMode } from './bridge/eventBridge';
import { GanttView } from './components/GanttView';
import { ListView } from './components/ListView';
import { ProtocolView } from './components/ProtocolView';
import { filterListEntries, filterProtocolDays, matchingTaskIds } from './domain/search';
import { useSearchHighlight } from './hooks/useSearchHighlight';
import { projectProtocol } from './domain/protocol';
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
  const [viewMode, updateViewMode] = useState<ViewMode>('list');
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [filterEnabled, setFilterEnabled] = useState(false);
  const pendingSource = useRef<EditorTarget | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [helpPage, setHelpPage] = useState<HelpPage>('shortcuts');
  const [windowMode, setWindowMode] = useState<WindowMode>('window');
  const [startupComplete, setStartupComplete] = useState(false);
  useWindowPresentation(startupComplete);
  const isMiniMode = windowMode === 'mini';
  useSearchHighlight(isMiniMode ? '' : newTaskTitle);
  const confirmedMode = useRef<WindowMode | null>(null);
  const modeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingModeReply = useRef<((mode: WindowMode) => void) | null>(null);
  const requestModeRef = useRef<(mode: WindowMode, automatic?: boolean, expectedMode?: WindowMode) => void>(() => {});
  const modeVersion = useRef(0);
  const nativeRevision = useRef(-1);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [editOwner, setEditOwner] = useState<'view' | 'detail'>('view');
  const mainScrollRef = useRef<HTMLElement>(null);
  // Positions live only for this app session. Capture before replacing content:
  // the shared scroller may clamp its position as the next view is mounted.
  const viewScrollPositions = useRef<Partial<Record<ViewMode, { top: number; left: number }>>>({});
  const setViewMode = useCallback((next: ViewMode) => {
    if (next === viewMode) return;
    const scroll = mainScrollRef.current;
    if (scroll) viewScrollPositions.current[viewMode] = { top: scroll.scrollTop, left: scroll.scrollLeft };
    updateViewMode(next);
  }, [viewMode]);
  useLayoutEffect(() => {
    const scroll = mainScrollRef.current;
    if (!scroll) return;
    const saved = viewScrollPositions.current[viewMode];
    scroll.scrollLeft = saved?.left ?? 0;
    // Protocol restores its own position together with its virtual window and
    // follows the newest entries only on its first visit (or while at the end).
    if (viewMode !== 'protocol') scroll.scrollTop = saved?.top ?? 0;
  }, [viewMode]);
  const protocolNavigation = useRef<((direction: number) => void) | null>(null);
  const miniScrollRef = useRef<HTMLElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const miniInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = isMiniMode ? miniScrollRef : mainScrollRef;
  const newTaskInputRef = isMiniMode ? miniInputRef : mainInputRef;
  // Frozen drag members/database remain available until drop callbacks consume them.
  const dragIdentity = useRef<DragIdentity | null>(null);
  const { toasts, pushToast } = useToasts();
  // Compact actions have their own selection; minimizing must preserve main details.
  const mainSelection = useTaskSelection(!isMiniMode);
  const miniSelection = useTaskSelection(isMiniMode);
  const selection = isMiniMode ? miniSelection : mainSelection;
  const finishEditing = useRef<() => Promise<boolean>>(async () => true);
  const editingPending = useRef<() => boolean>(() => false);
  const database = useDatabaseSnapshot(pushToast, dragIdentity, () => {
    editors.cancelEdit();
    setNewTaskTitle('');
    setFilterEnabled(false);
    pendingSource.current = null;
    mainSelection.reset();
    miniSelection.reset();
  }, () => finishEditing.current(), () => editingPending.current());
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
  const state = useMemo(() => projectEvents(events, now), [events, now, language]);
  const needsProtocol = viewMode === 'protocol' || newTaskTitle.length > 0;
  const protocolDays = useMemo(() => needsProtocol ? projectProtocol(events, state.tasks) : [], [needsProtocol, events, state.tasks]);
  const matchingIds = useMemo(() => matchingTaskIds(state.tasks, protocolDays, newTaskTitle), [state.tasks, protocolDays, newTaskTitle, language]);
  const filtering = filterEnabled && newTaskTitle.length > 0;
  // Keep the complete task map for actions/details; only view collections shrink.
  const visibleState = useMemo(() => filtering ? { ...state,
    openTasks: state.openTasks.filter(task => matchingIds.has(task.id)),
    completedTasks: state.completedTasks.filter(task => matchingIds.has(task.id)),
    listEntries: filterListEntries(state.listEntries, matchingIds),
  } : state, [state, filtering, matchingIds]);
  const visibleProtocol = useMemo(() => filtering ? filterProtocolDays(protocolDays, matchingIds) : protocolDays, [protocolDays, filtering, matchingIds]);
  const editors = useInlineEditors(
    database,
    state.tasks,
    now,
    setLastMovedKey,
    () => selection.setContextMenu(null)
  );
  // All destructive boundaries use the same completion contract. A drained
  // queue does not mean a failed inline draft has been saved.
  finishEditing.current = async () => await descriptions.flushAll() && !editors.hasOpen();
  // Preserve the admission rule: a pending inline write rejects a database
  // switch; description saves/imports may finish before switching.
  editingPending.current = descriptions.hasPending;
  const scopedEditor = (editor: InlineEditor, owner: 'view' | 'detail'): InlineEditor => ({
    ...editor,
    taskId: editOwner === owner ? editor.taskId : null,
    onStart: task => { setSelectedTaskId(task.id); setEditOwner(owner); editor.onStart(task); },
  });
  // A single editing session has one visible input, not two competing autofocus effects.
  const titleEditor = scopedEditor(editors.titleEditor, 'view');
  const dateEditor = scopedEditor(editors.dateEditor, 'view');
  const nativeDetailMenus = useRef(0);
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
    state: visibleState,
    onSearch: () => {
      if (document.activeElement === mainInputRef.current) setFilterEnabled(value => !value);
      else { setFilterEnabled(true); mainInputRef.current?.focus(); mainInputRef.current?.select(); }
    },
    onResetSearch: () => {
      if (!newTaskTitle && !filterEnabled && document.activeElement !== mainInputRef.current) return false;
      setNewTaskTitle(''); setFilterEnabled(false); pendingSource.current = null; mainInputRef.current?.blur(); return true;
    },
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
    onNavigateTask: !isMiniMode && viewMode === 'protocol' ? direction => protocolNavigation.current?.(direction) : undefined,
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
    const unsubMode = eventBridge.onWindowModeChanged((mode, revision) => {
      if (revision !== undefined) {
        if (revision <= nativeRevision.current) return;
        nativeRevision.current = revision;
      }
      modeVersion.current++;
      confirmedMode.current = mode;
      setWindowMode(mode);
      pendingModeReply.current?.(mode);
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
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.inert = true;
      void finishEditing.current().then(async saved => {
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
    const submittedTitle = newTaskTitle;
    const trimmed = normalizeTitleInput(submittedTitle).trim();
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
        ...((appSettings?.defaultDuration ?? 1) !== 1 || (appSettings?.defaultDurationUnit ?? 'days') !== 'days'
          ? [{ type: 'TASK_TIMING_SET' as const, payload: { taskId, duration: appSettings?.defaultDuration ?? 1, durationUnit: appSettings?.defaultDurationUnit ?? 'days', progress: null } }] : []),
        ...(source ? [{ type: 'TASK_DESCRIPTION_SET' as const,
          payload: { taskId, description: appendTaskSources('', [source]) } }] : []),
      ])
    );
    if (!updated) return;
    if (pendingSource.current === source) pendingSource.current = null;
    setNewTaskTitle((current) => (current === submittedTitle ? '' : current));
    setSelectedTaskId(taskId);
  };
  const handleCreateSourceTask = (source: EditorTarget) => {
    pendingSource.current = source;
    newTaskInputRef.current?.focus();
  };
  // Queue closures must read current guards, never the render that enqueued them.
  const transitionState = useRef({ showSettingsModal, showShortcutsModal, contextMenu, mainSelection, isDetailPanelOpen });
  transitionState.current = { showSettingsModal, showShortcutsModal, contextMenu, mainSelection, isDetailPanelOpen };
  const automaticBlocked = () => {
    const current = transitionState.current;
    return current.showSettingsModal || current.showShortcutsModal || current.contextMenu || nativeDetailMenus.current > 0 ||
      activeInlineEditor.current || Boolean(document.activeElement?.closest('[data-description-editor],[data-task-log]')) || descriptions.hasDrafts();
  };
  // Queue requests and commit the destination layout before native geometry changes.
  // Failed transitions roll back to the last confirmed mode without blanking the root.
  const requestWindowMode = (mode: WindowMode, automatic = false, expectedMode?: WindowMode, selectTaskId?: string): Promise<boolean> => {
    const operation = modeQueue.current.then(async () => {
      if (expectedMode !== undefined && confirmedMode.current !== expectedMode) return false;
      if (confirmedMode.current === mode && !selectTaskId) return true;
      if (automatic && mode === 'mini' && automaticBlocked()) return false;
      if (mode === 'mini' || mode === 'taskbar') {
        if (!await finishEditing.current()) return false;
        if (expectedMode !== undefined && confirmedMode.current !== expectedMode) return false;
        if (automatic && mode === 'mini' && automaticBlocked()) return false;
      }
      const version = ++modeVersion.current;
      const before = transitionState.current;
      const rollbackSelection = () => {
        if (!selectTaskId) return;
        before.mainSelection.restoreSelection();
        setIsDetailPanelOpen(before.isDetailPanelOpen);
      };
      // Destination task and details are committed with the destination layout.
      flushSync(() => {
        if (mode === 'mini' && confirmedMode.current !== 'mini') miniSelection.reset();
        if (selectTaskId) { before.mainSelection.setSelectedTaskId(selectTaskId); setIsDetailPanelOpen(true); }
        setWindowMode(mode);
      });
      await allowWindowPaint();
      // The paint opportunity is asynchronous: a native event or new editor may
      // have superseded this request while the destination surface was prepared.
      if (modeVersion.current !== version) {
        if (confirmedMode.current !== mode) flushSync(rollbackSelection);
        return confirmedMode.current === mode;
      }
      if (automatic && mode === 'mini' && automaticBlocked()) {
        flushSync(() => { rollbackSelection(); setWindowMode(confirmedMode.current ?? 'window'); });
        return false;
      }
      let confirmed: WindowMode;
      // Native confirmation is sufficient even if the bridge response is lost.
      // Promise.race also consumes a later rejected/stale bridge completion.
      const nativeReply = new Promise<WindowMode>(resolve => { pendingModeReply.current = resolve; });
      try { confirmed = await Promise.race([eventBridge.setWindowMode(mode), nativeReply]); }
      catch (error) {
        if (modeVersion.current === version) flushSync(() => { rollbackSelection(); setWindowMode(confirmedMode.current ?? 'window'); });
        throw error;
      } finally { pendingModeReply.current = null; }
      if (modeVersion.current === version) {
        confirmedMode.current = confirmed;
        flushSync(() => { if (confirmed !== mode) rollbackSelection(); setWindowMode(confirmed); });
      }
      if (confirmedMode.current !== mode) { flushSync(rollbackSelection); return false; }
      if (selectTaskId) before.mainSelection.clearEdgeSelection();
      if (confirmed === mode) {
        setContextMenu(null);
        if (before.showShortcutsModal) setShowShortcutsModal(false);
        if (before.showSettingsModal) setShowSettingsModal(false);
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
    return requestWindowMode('window', false, undefined, selectTaskId);
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
  // Retain view-local geometry, scroll, log drafts and description undo. Inert
  // removes hidden controls from focus and global target queries; native file
  // callbacks and the retained description editor also have explicit activity guards.
  const miniSurface = isMiniMode ? (
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
    ) : null;
  const listBackgroundKey = 'list-background';
  const todayKey = toDateKey(now);
  return (
    <>
    {miniSurface}
    <div hidden={isMiniMode} {...{ inert: isMiniMode ? '' : undefined }} style={isMiniMode ? { display: 'none' } : undefined} className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 overflow-hidden"
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
        newTaskInputRef={mainInputRef}
        filterEnabled={filterEnabled}
        onToggleFilter={() => { setFilterEnabled(value => !value); mainInputRef.current?.focus(); }}
        onSubmit={event => {
          if (!filterEnabled) { void handleCreateTask(event); return; }
          event.preventDefault();
          const id = viewMode === 'protocol' ? visibleProtocol[0]?.entries[0]?.taskId
            : mainScrollRef.current?.querySelector<HTMLElement>('[data-task-drag]')?.dataset.taskDrag;
          if (id) { editors.cancelEdit(); clearEdgeSelection(); setSelectedTaskId(id); setIsDetailPanelOpen(true); }
        }}
        onCreateTask={handleCreateTask}
        onUndo={historyActions.handleUndo}
        onRedo={historyActions.handleRedo}
        onSettings={database.openSettings}
        onHelp={() => { setHelpPage('shortcuts'); setShowShortcutsModal(true); }}
      />
      <div className="flex-1 flex overflow-hidden">
        <TaskDetailPanel
          active={!isMiniMode}
          onNativeMenuChange={open => { nativeDetailMenus.current += open ? 1 : -1; }}
          open={isDetailPanelOpen}
          onToggle={() => setIsDetailPanelOpen(open => !open)}
          onSyntaxHelp={() => { setHelpPage('syntax'); setShowShortcutsModal(true); }}
          key={appSettings?.activeDatabasePath ?? ''}
          task={descriptions.taskWithDraft(mainSelection.selectedTaskId ? state.tasks[mainSelection.selectedTaskId] ?? null : null)}
          interactions={interactions} titleEditor={scopedEditor(editors.titleEditor, 'detail')} dateEditor={scopedEditor(editors.dateEditor, 'detail')}
          onClose={() => setIsDetailPanelOpen(false)}
          onToggleActive={actions.handleToggleActive}
          onCompleteTask={actions.handleCompleteTask} onReopenTask={actions.handleReopenTask}
          onSetConfiguredDate={actions.handleSetConfiguredDate} onRemovePredecessor={actions.handleRemovePredecessor}
          onTimingChange={async (taskId, timing) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_TIMING_SET', { taskId, ...timing }));
            if (!result) throw new Error(t('Änderung konnte nicht gespeichert werden'));
          }}
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
            ref={mainScrollRef}
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
            className={`flex-1 overflow-y-auto overflow-x-auto ${viewMode === 'gantt' || viewMode === 'protocol' ? '' : 'px-6 py-5'}`}
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
                scrollRef={mainScrollRef}
                {...interactions}
                listEntries={visibleState.listEntries}
                movedItemKey={lastMovedKey}
                titleEditor={isMiniMode ? { ...titleEditor, taskId: null } : titleEditor}
                dateEditor={isMiniMode ? { ...dateEditor, taskId: null } : dateEditor}
              />
            ) : viewMode === 'network' ? (
              <NetworkPlanView
                hideEmptyDates={filtering}
                scrollRef={mainScrollRef}
                {...interactions}
                openTasks={visibleState.openTasks}
                now={now}
                titleEditor={isMiniMode ? { ...titleEditor, taskId: null } : titleEditor}
                dateEditor={isMiniMode ? { ...dateEditor, taskId: null } : dateEditor}
              />
            ) : viewMode === 'protocol' ? (
              <ProtocolView
                key={appSettings?.activeDatabasePath ?? ''}
                {...interactions} days={visibleProtocol} tasks={state.tasks} now={now}
                scrollRef={mainScrollRef} navigationRef={protocolNavigation}
                initialScrollTop={viewScrollPositions.current.protocol?.top}
                onSelectTaskByKeyboard={setSelectedTaskId}
                titleEditor={isMiniMode ? { ...titleEditor, taskId: null } : titleEditor}
                dateEditor={isMiniMode ? { ...dateEditor, taskId: null } : dateEditor}
                onOpenTask={id => { editors.cancelEdit(); setSelectedTaskId(id); setIsDetailPanelOpen(true); }}
                onNativeMenuChange={open => { nativeDetailMenus.current += open ? 1 : -1; }}
                onError={error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning')}
              />
            ) : (
              <GanttView
                {...interactions}
                openTasks={visibleState.openTasks}
                listEntries={visibleState.listEntries}
                now={now}
                titleEditor={isMiniMode ? { ...titleEditor, taskId: null } : titleEditor}
              />
            )}
          </main>
          <DependencyHighlightIndicators
            key={viewMode}
            scrollRef={mainScrollRef}
            contentKey={highlights}
            horizontal={viewMode === 'gantt'}
            topInset={viewMode === 'gantt' ? undefined : viewMode === 'network' ? 36 : 48}
          />
        </div>
        <TaskSidebar
          tasks={state.tasks}
          completedTasks={visibleState.completedTasks}
          completedTotal={filterEnabled ? state.completedTasks.length : undefined}
          now={now}
          interactions={interactions}
          onResubmitTasks={actions.handleResubmitTasks}
          onCompleteTask={actions.handleCompleteTask}
        />
      </div>
      {!isMiniMode && taskContextMenu}
      <ShortcutHelp
        open={!isMiniMode && showShortcutsModal}
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
          onSetDefaultDuration={database.handleSetDefaultDuration}
          onRunSetupAction={database.handleRunSetupAction}
          onOpenFolderInExplorer={(path, isFile) => eventBridge.openFolderInExplorer(path, isFile)}
          onOpenFolderInVSCode={(path, isFile) => eventBridge.openFolderInVSCode(path, isFile)}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
    </>
  );
}
