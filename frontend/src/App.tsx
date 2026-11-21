import { selectionActionIds } from './domain/selection';
import { openTarget } from './components/editor/contextMenu';
import { contextMenuAnchor } from './hooks/keyboardNavigation';
import { useProjects } from './hooks/useProjects';
import { SaveCompletionContext } from './hooks/saveCompletion';
import { newTaskMemberships, projectProgress } from './domain/projects';
import { DeleteProjectDialog, ProjectContext, ProjectList, ProjectDetails } from './components/Projects';
import { useTimeMarkers } from './hooks/useTimeMarkers';
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
import { projectMenuSources, TaskContextMenu } from './components/TaskContextMenu';
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
  const markerEditing = useRef(false);
  const [viewMode, updateViewMode] = useState<ViewMode>('list');
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [retainedTaskId, retainTask] = useState<string | null>(null);
  const [projectDetailId, setProjectDetailId] = useState<string | null>(null);
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [successorOf, setSuccessorOf] = useState<string | null>(null);
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
  const projectDrag = useRef<{ database: string; origin: string; ids: string[] } | null>(null);
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
    timeMarkers.reset();
    projects.reset();
    setSuccessorOf(null);
    setDeleteId(null); retainTask(null);
    setProjectDetailId(null);
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
  const projects = useProjects(database);
  const descriptions = useDescriptionDrafts(database);
  const state = useMemo(() => projectEvents(events, now), [events, now, language]);
  const needsProtocol = viewMode === 'protocol' || newTaskTitle.length > 0;
  const protocolDays = useMemo(() => needsProtocol ? projectProtocol(events, state.tasks) : [], [needsProtocol, events, state.tasks]);
  const projectIds = projects.selectedIds;
  const textFilter = filterEnabled && newTaskTitle.length > 0;
  const filtering = textFilter || projectIds.length > 0;
  const matchesProjectFilter = useCallback((taskId: string) =>
    !projectIds.length || projectIds.some(id => projects.members.get(taskId)?.has(id)),
  [projectIds, projects.members]);
  const matchingIds = useMemo(() => {
    const ids = matchingTaskIds(state.tasks, protocolDays, textFilter ? newTaskTitle : '');
    for (const id of ids) if (!matchesProjectFilter(id)) ids.delete(id);
    return ids;
  }, [state.tasks, protocolDays, textFilter, newTaskTitle, matchesProjectFilter, language]);
  useEffect(() => {
    if (!projectIds.length) return;
    for (const current of [mainSelection, miniSelection]) {
      const remaining = current.selectedTaskIds.filter(matchesProjectFilter);
      if (remaining.length !== current.selectedTaskIds.length) current.setSelectedTaskIds(remaining);
      if (current.contextMenu && !current.contextMenu.relation && !matchesProjectFilter(current.contextMenu.taskId)) current.setContextMenu(null);
      if (current.selectedEdgeKeys.some(key => key.split('->').some(id => !matchesProjectFilter(id)))) current.clearEdgeSelection();
    }
  }, [matchesProjectFilter, projectIds, mainSelection.selectedTaskIds, miniSelection.selectedTaskIds,
    mainSelection.contextMenu, miniSelection.contextMenu, mainSelection.selectedEdgeKeys, miniSelection.selectedEdgeKeys]);
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
  const finishSaves = async () => {
    const identity = database.databaseIdentity.current;
    const saved = await database.saves.finish(
      async () => await projects.flush() && await descriptions.flushDrafts(),
      () => projects.hasPending() || descriptions.hasDrafts()
    );
    return saved && identity === database.databaseIdentity.current;
  };
  finishEditing.current = async () => await finishSaves() && !editors.hasOpen() && !timeMarkers.hasOpen();
  // Preserve the admission rule: a pending inline write rejects a database
  // switch; description saves/imports may finish before switching.
  editingPending.current = () => projects.hasPending() || descriptions.hasPending();
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
    setNow, projectIds
  );
  const timeMarkers = useTimeMarkers(database, state, now, dragIdentity, () => {
    selection.setSelectedTaskId(null); selection.clearEdgeSelection();
  }, pushToast, setLastMovedKey, setNow);
  markerEditing.current = timeMarkers.hasOpen();
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
    const ids = selectionActionIds(taskId, selectedTaskIds);
    await descriptions.appendSources(ids, sources);
  }, error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning'));
  const historyActions = {
    ...actions,
    handleUndo: async () => { if (await finishSaves()) await actions.handleUndo(); },
    handleRedo: async () => { if (await finishSaves()) await actions.handleRedo(); },
  };
  const miniTasks = useMemo(
    () => computeMiniWindowTasks(state.openTasks.filter(task => matchesProjectFilter(task.id)), now),
    [matchesProjectFilter, state.openTasks, now]
  );
  useGlobalShortcuts({
    selection,
    actions: historyActions,
    state: visibleState,
    onSearch: () => {
      setSuccessorOf(null);
      if (document.activeElement === mainInputRef.current) setFilterEnabled(value => !value);
      else { setFilterEnabled(true); mainInputRef.current?.focus(); mainInputRef.current?.select(); }
    },
    onResetSearch: () => {
      if (!newTaskTitle && !filterEnabled && document.activeElement !== mainInputRef.current) return false;
      setSuccessorOf(null); setNewTaskTitle(''); setFilterEnabled(false); pendingSource.current = null; mainInputRef.current?.blur(); return true;
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
    // Keep an expiring marker mounted while its editor owns an unsaved draft.
    const interval = setInterval(() => { if (!markerEditing.current) setNow(new Date()); }, 60_000);
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
  const createTask = async (title: string, projectIds: string[], source?: EditorTarget | null, predecessorId?: string | null) => {
    const trimmed = normalizeTitleInput(title).trim();
    if (!trimmed || mutationBusy.current) return false;
    const taskId = projectEvents(
      confirmedEvents.current,
      new Date()
    ).nextTaskId;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() =>
      eventBridge.appendBatch([
        { type: 'TASK_CREATED', payload: {
          taskId, title: trimmed, configuredStart: now.toISOString(), createdAt: now.toISOString(),
        } },
        ...((appSettings?.defaultDuration ?? 1) !== 1 || (appSettings?.defaultDurationUnit ?? 'days') !== 'days'
          ? [{ type: 'TASK_TIMING_SET' as const, payload: { taskId, duration: appSettings?.defaultDuration ?? 1, durationUnit: appSettings?.defaultDurationUnit ?? 'days', progress: null } }] : []),
        ...newTaskMemberships(taskId, projectIds),
        ...(predecessorId ? [{ type: 'DEPENDENCY_ADDED' as const, payload: { predecessorId, taskId } }] : []),
        ...(source ? [{ type: 'TASK_DESCRIPTION_SET' as const,
          payload: { taskId, description: appendTaskSources('', [source]) } }] : []),
      ])
    );
    if (!updated) return false;
    setProjectDetailId(null);
    setSelectedTaskId(taskId);
    return true;
  };
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const submittedTitle = newTaskTitle;
    const source = pendingSource.current;
    const memberships = successorOf ? [...(projects.members.get(successorOf) ?? [])] : projectIds;
    if (!await createTask(submittedTitle, memberships, source, successorOf)) return;
    setSuccessorOf(null);
    if (pendingSource.current === source) pendingSource.current = null;
    setNewTaskTitle((current) => (current === submittedTitle ? '' : current));
  };
  const handleCreateSourceTask = (source: EditorTarget) => {
    setSuccessorOf(null);
    pendingSource.current = source;
    newTaskInputRef.current?.focus();
  };
  // Queue closures must read current guards, never the render that enqueued them.
  const transitionState = useRef({ showSettingsModal, showShortcutsModal, contextMenu, mainSelection, isDetailPanelOpen });
  transitionState.current = { showSettingsModal, showShortcutsModal, contextMenu, mainSelection, isDetailPanelOpen };
  const automaticBlocked = () => {
    const current = transitionState.current;
    return document.querySelector('dialog[open]') !== null || current.showSettingsModal || current.showShortcutsModal || current.contextMenu || nativeDetailMenus.current > 0 ||
      activeInlineEditor.current || Boolean(document.activeElement?.closest('[data-description-editor],[data-task-log]')) || database.saves.hasImports() || descriptions.hasDrafts() || projects.hasPending() ||
      Boolean(document.activeElement?.closest('[data-project-details] input, [data-project-list] input'));
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
    orderedTaskIds: visibleState.listEntries.flatMap(entry => entry.kind === 'task' ? [entry.task.id] : []),
    selectedEdgeKeys,
    highlights,
    deletionPreview,
    timeline: { ...timeMarkers, bindTask: actions.handleSetTimeMarker },
    onSelectTask: (...args) => { timeMarkers.select(null); selection.onSelectTask(...args); },
    onContextMenuTask: selection.onContextMenuTask,
    onSelectEdge: (...args) => { timeMarkers.select(null); selection.onSelectEdge(...args); },
    onClearEdgeSelection: clearEdgeSelection,
    onClearTaskSelection: () => setSelectedTaskId(null),
    ...drag,
    onInsertTask: actions.handleInsertTask,
    onAddPredecessor: actions.handleAddPredecessor,
    onRemoveDependencyBetween: actions.handleRemoveDependencyBetween,
    onSetConfiguredDate: (id, date, label) => actions.handleSetConfiguredDate(id, date, label, true),
    onToggleActive: actions.handleToggleActive,
  };
  const projectSources = (taskId: string) => [...(projects.members.get(taskId) ?? [])].flatMap(id =>
    [projects.projects.get(id)?.description ?? '', ...(projects.logs.get(id) ?? []).map(entry => entry.text)]);
  const startSuccessor = (id: string) => {
    setSuccessorOf(id); pendingSource.current = null; setFilterEnabled(false);
    newTaskInputRef.current?.focus(); newTaskInputRef.current?.select();
  };
  const taskContextMenu = contextMenu && state.tasks[contextMenu.taskId] && (
    <TaskContextMenu
      contextMenu={contextMenu}
      task={state.tasks[contextMenu.taskId]}
      projectDescriptions={projectSources(contextMenu.taskId)}
      databaseKey={appSettings?.activeDatabasePath ?? ''}
      onClose={() => setContextMenu(null)}
      onToggleActive={actions.handleToggleActive}
      onSetConfiguredDate={actions.handleSetConfiguredDate}
      onRemovePredecessor={actions.handleRemovePredecessor}
      onCompleteTask={actions.handleCompleteTask}
      onReopenTask={actions.handleReopenTask}
      onOpenCopy={actions.handleOpenCopy}
      onCreateSuccessor={startSuccessor}
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
  const shownTaskId = mainSelection.selectedTaskId ?? retainedTaskId;
  const selectProject = (id: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, taskId?: string) => {
    if (taskId) {
      projects.selectLabel(taskId, id, !!(event?.ctrlKey || event?.metaKey || event?.shiftKey));
      return;
    }
    if (mainSelection.selectedTaskId && isDetailPanelOpen) retainTask(mainSelection.selectedTaskId);
    projects.selectProject(id, event);
  };
  const showProject = async (id: string) => {
    const db = database.databaseIdentity.current;
    if (isMiniMode && !await requestWindowMode('window')) return;
    if (db !== database.databaseIdentity.current) return;
    retainTask(null); mainSelection.reset(); setProjectDetailId(id);
  };
  const menuProject = async (id: string, event: React.MouseEvent) => {
    const anchor = contextMenuAnchor(event);
    const db = database.databaseIdentity.current;
    const project = projects.drafts.current.get(id) ?? projects.projects.get(id);
    if (!project) return;
    nativeDetailMenus.current++;
    try {
      const sources = await projectMenuSources([project.description, ...(projects.logs.get(id) ?? []).map(note => note.text)]);
      if (database.databaseIdentity.current !== db) return;
      const action = await eventBridge.showTaskContextMenu([
        { id: 'details', label: t('Details anzeigen'), disabled: false },
        { id: 'filter', label: t('Nur dieses Projekt anzeigen'), disabled: false },
        ...sources.items,
        { id: 'delete', label: t('Projekt löschen'), disabled: false },
      ], anchor);
      if (database.databaseIdentity.current !== db) return;
      if (action === 'details') await showProject(id);
      else if (action === 'filter') selectProject(id);
      else if (action === 'delete') {
        if (isMiniMode && !await requestWindowMode('window')) return;
        if (database.databaseIdentity.current === db) setDeleteId(id);
      } else {
        const target = sources.target(action);
        if (target) await openTarget(target);
      }
    } catch (error) { pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning'); }
    finally { nativeDetailMenus.current--; }
  };
  const projectList = <ProjectList clear={projects.clearProjects} enabled={snapshotReady} reorder={projects.reorder}
    projects={projects.orderedIds.map(id => projects.projects.get(id)!)}
    create={async code => { const id = await projects.create(code); if (id) { retainTask(null); mainSelection.reset(); setProjectDetailId(id); } return !!id; }}
    onTaskDrop={id => {
      const origin = dragIdentity.current;
      if (origin && origin.database === database.databaseIdentity.current) projects.assign(origin.taskIds, selectionActionIds(id, projects.selectedIds));
    }}/>;
  const detailId = !mainSelection.selectedTaskId ? projectDetailId : null;
  const detailProject = detailId && (projects.drafts.current.get(detailId) ?? projects.projects.get(detailId));
  const listBackgroundKey = 'list-background';
  const todayKey = toDateKey(now);
  return (
    <SaveCompletionContext.Provider value={database.saves}>
    <ProjectContext.Provider value={{ ...projects, select: selectProject, details: showProject, menu: menuProject }}>
    {deleteId && projects.projects.has(deleteId) && <DeleteProjectDialog code={projects.projects.get(deleteId)!.code} cancel={() => setDeleteId(null)}
      confirm={async () => {
        const db = database.databaseIdentity.current;
        if (!await projects.flush() || db !== database.databaseIdentity.current) return;
        if (await mutate(() => eventBridge.deleteProject(db, deleteId))) {
          if (projectDetailId === deleteId) setProjectDetailId(null);
          setDeleteId(null);
        }
      }}/>}
    {miniSurface}
    <div hidden={isMiniMode} {...{ inert: isMiniMode ? '' : undefined }} style={isMiniMode ? { display: 'none' } : undefined} className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 overflow-hidden"
      onClickCapture={event => {
        const hit = event.target as Element;
        if (hit.closest('main') && !hit.closest('[data-project-task]')) retainTask(null);
        if (hit.closest('[data-source-task-id]') && !hit.closest('[data-project-task]')) setProjectDetailId(null);
        if (projects.selectedLabels.length && !(event.target as Element).closest('[data-project-task]')) projects.setSelectedLabels([]);
      }}
      onDragStartCapture={event => {
        const chip = (event.target as Element).closest<HTMLElement>('[data-project-drag]');
        const id = chip?.dataset.projectDrag;
        if (!id) return;
        const taskId = chip.dataset.projectTask;
        const labels = projects.selectedLabels;
        const ids = taskId
          ? labels.some(label => label.taskId === taskId && label.projectId === id)
            ? [...new Set(labels.map(label => label.projectId))] : [id]
          : selectionActionIds(id, projects.selectedIds);
        projectDrag.current = { database: database.databaseIdentity.current, origin: id, ids };
      }}
      onDragEndCapture={() => { projectDrag.current = null; }}
      onDragOverCapture={event => {
        if ((event.target as Element).closest('[data-project-list]') && !event.dataTransfer?.types?.includes('application/x-dodrag-member')) return;
        if (event.dataTransfer?.types?.includes('application/x-dodrag-project')) { event.preventDefault(); event.stopPropagation(); }
      }}
      onDropCapture={event => {
        const projectId = event.dataTransfer?.getData?.('application/x-dodrag-project');
        if (!projectId) return;
        if ((event.target as Element).closest('[data-project-list]') && !event.dataTransfer.getData('application/x-dodrag-member')) return;
        event.preventDefault(); event.stopPropagation();
        const target = event.target as Element;
        const source = event.dataTransfer.getData('application/x-dodrag-member');
        if (target.closest('[data-project-list]')) {
          if (source) projects.remove(source, projectId);
        } else {
          const taskId = target.closest<HTMLElement>('[data-source-task-id]')?.dataset.sourceTaskId ??
            (target.closest('[data-task-detail-panel]') ? shownTaskId : null);
          const drag = projectDrag.current;
          if (taskId && drag?.origin === projectId && drag.database === database.databaseIdentity.current) {
            projects.assign(selectionActionIds(taskId, selectedTaskIds), drag.ids);
          }
        }
      }}
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
        successorOf={successorOf}
        viewMode={viewMode}
        setViewMode={setViewMode}
        nextTaskId={state.nextTaskId}
        openTaskCount={state.openTasks.length}
        todayBalance={state.todayBalance}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        snapshotReady={snapshotReady}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        newTaskInputRef={mainInputRef}
        filterEnabled={filterEnabled}
        onToggleFilter={() => { setSuccessorOf(null); setFilterEnabled(value => !value); mainInputRef.current?.focus(); }}
        onSubmit={event => {
          if (!filterEnabled) { void handleCreateTask(event); return; }
          event.preventDefault();
          const id = viewMode === 'protocol' ? visibleProtocol[0]?.entries[0]?.taskId
            // Date/time dividers are draggable too; only task cards are search results.
            : mainScrollRef.current?.querySelector<HTMLElement>('[data-source-task-id]')?.dataset.sourceTaskId;
          if (id) { editors.cancelEdit(); clearEdgeSelection(); setSelectedTaskId(id); setIsDetailPanelOpen(true); }
        }}
        onCreateTask={handleCreateTask}
        onUndo={historyActions.handleUndo}
        onRedo={historyActions.handleRedo}
        onSettings={database.openSettings}
        onHelp={() => { setHelpPage('shortcuts'); setShowShortcutsModal(true); }}
      />
      {projectList}
      <div className="flex-1 flex overflow-hidden">
        {detailProject ? <ProjectDetails key={detailProject.projectId} project={detailProject}
          deleteProject={() => setDeleteId(detailProject.projectId)}
          createTask={title => createTask(title, [...new Set([...projectIds, detailProject.projectId])])}
          entries={projects.logs.get(detailProject.projectId) ?? []}
          saveNote={async (entryId, text) => {
            const result = await mutate(() => eventBridge.appendEvent('PROJECT_NOTE_SET', { projectId: detailProject.projectId, entryId, text }));
            if (!result) throw new Error(t('Änderung konnte nicht gespeichert werden'));
          }}
          progress={projectProgress(Object.values(state.tasks).filter(task => projects.members.get(task.id)?.has(detailProject.projectId)))}
          active={!isMiniMode} onNativeMenuChange={open => { nativeDetailMenus.current += open ? 1 : -1; }}
          change={projects.change} flush={() => void projects.flush()} onError={error => pushToast(errorText(t('Aktion fehlgeschlagen'), error), 'warning')}/>
          : <TaskDetailPanel
          tasks={state.tasks}
          onCreateSuccessor={startSuccessor}
          projectDescriptions={projectSources(shownTaskId ?? '')}
          active={!isMiniMode}
          onNativeMenuChange={open => { nativeDetailMenus.current += open ? 1 : -1; }}
          open={isDetailPanelOpen}
          onToggle={() => setIsDetailPanelOpen(open => !open)}
          onSyntaxHelp={() => { setHelpPage('syntax'); setShowShortcutsModal(true); }}
          key={appSettings?.activeDatabasePath ?? ''}
          task={descriptions.taskWithDraft(shownTaskId ? state.tasks[shownTaskId] ?? null : null)}
          interactions={interactions} titleEditor={scopedEditor(editors.titleEditor, 'detail')} dateEditor={scopedEditor(editors.dateEditor, 'detail')}
          onClose={() => setIsDetailPanelOpen(false)}
          onToggleActive={actions.handleToggleActive}
          onCompleteTask={actions.handleCompleteTask} onReopenTask={actions.handleReopenTask} onOpenCopy={actions.handleOpenCopy}
          onSetConfiguredDate={actions.handleSetConfiguredDate} onRemovePredecessor={actions.handleRemovePredecessor}
          onTimingChange={async (taskId, timing) => {
            const result = await mutate(() => eventBridge.appendEvent('TASK_TIMING_SET', { taskId, ...timing }));
            if (!result) throw new Error(t('Änderung konnte nicht gespeichert werden'));
          }}
          descriptionSaveState={shownTaskId ? descriptions.protectionState(shownTaskId) : 'saved'}
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
        />}
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
            {filtering && (viewMode === 'protocol' ? !visibleProtocol.length : !visibleState.openTasks.length) ? (
              <div className="mx-auto mt-10 max-w-sm px-4 text-center text-sm text-slate-600">
                <p role="status">{textFilter ? t('Keine Tasks gefunden.') : t('Keine Tasks für diese Projekte verfügbar.')}</p>
                {projectIds.length > 0 && <button type="button" className="mt-3 rounded border border-slate-300 bg-white px-3 py-1.5 text-sky-800"
                  onClick={projects.clearProjects}>{t('Projektfilter aufheben')}</button>}
              </div>
            ) : viewMode === 'list' ? (
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
                projectFilterActive={projectIds.length > 0}
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
                projectFilterActive={projectIds.length > 0}
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
            await changeDatabase(async () => {
              const settings = await eventBridge.getSettings();
              // A failed startup leaves the native store closed. Reading settings
              // alone cannot recover when a delayed drive becomes available.
              if (!settings.databaseReady && settings.activeDatabasePath)
                return eventBridge.switchDatabase(settings.activeDatabasePath);
              return settings;
            });
          }}
          onSelectFolder={() => eventBridge.selectFolderDialog()}
          onCreateDatabase={database.handleCreateDatabase}
          onOpenExistingDatabase={database.handleOpenExistingDatabase}
          onSwitchDatabase={database.handleSwitchDatabase}
          onDeleteDatabase={database.handleDeleteDatabase}
          onToggleAutostart={database.handleToggleAutostart}
          onSetUILanguage={database.handleSetUILanguage}
          onSetDefaultDuration={database.handleSetDefaultDuration}
          onSetDefaultTimeMarkers={database.handleSetDefaultTimeMarkers}
          onRunSetupAction={database.handleRunSetupAction}
          onOpenFolderInExplorer={(path, isFile) => eventBridge.openFolderInExplorer(path, isFile)}
          onOpenFolderInVSCode={(path, isFile) => eventBridge.openFolderInVSCode(path, isFile)}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
    </ProjectContext.Provider>
    </SaveCompletionContext.Provider>
  );
}
