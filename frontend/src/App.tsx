import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  CornerDownRight,
  Flame,
  GitBranch,
  GripVertical,
  HelpCircle,
  Link2Off,
  List,
  Minimize2,
  Network,
  Plus,
  Redo2,
  Settings,
  Undo2,
  X,
} from 'lucide-react';
import { AppSettings, eventBridge } from './bridge/eventBridge';
import { DateLayerLine } from './components/DateLayerLine';
import { GanttView } from './components/GanttView';
import { MiniCornerView } from './components/MiniCornerView';
import { NetworkPlanView } from './components/NetworkPlanView';
import { SettingsModal } from './components/SettingsModal';
import { SmoothFlipList } from './components/SmoothFlipList';
import {
  calculateQuickResubmitDate,
  computeDependencyHighlights,
  computeMiniWindowTasks,
  formatIso8601Display,
  projectEvents,
  QuickResubmitTargetId,
} from './domain/projector';
import { HighlightRole, StoredEvent, TaskState } from './domain/types';
import { normalizeUserDate } from './domain/dates';

interface ContextMenuState {
  x: number;
  y: number;
  taskId: string;
}

interface ToastNotification {
  id: string;
  message: string;
  tone?: 'info' | 'warning' | 'success';
}

const RESUBMIT_TARGETS: Array<{
  id: QuickResubmitTargetId;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'plus_2h',
    label: '+2 Stunden',
    sublabel: 'Kurze Wiedervorlage heute',
    icon: <Clock className="w-4 h-4 text-sky-600" />,
  },
  {
    id: 'plus_1d',
    label: '+1 Tag',
    sublabel: 'Morgen früh um 09:00',
    icon: <CalendarClock className="w-4 h-4 text-teal-600" />,
  },
  {
    id: 'next_week',
    label: 'nächste Woche',
    sublabel: 'Nächster Montag 09:00',
    icon: <Calendar className="w-4 h-4 text-indigo-600" />,
  },
  {
    id: 'plus_7d',
    label: '+7 Tage',
    sublabel: 'Exakt eine Woche später',
    icon: <Calendar className="w-4 h-4 text-violet-600" />,
  },
  {
    id: 'next_month',
    label: 'nächsten Monat',
    sublabel: 'Erster Tag des Folgemonats',
    icon: <Calendar className="w-4 h-4 text-fuchsia-600" />,
  },
];

export function App() {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [now, setNow] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<'list' | 'network' | 'gantt'>('list');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedEdgeKeys, setSelectedEdgeKeys] = useState<string[]>([]);
  const [lastClickedEdgeKey, setLastClickedEdgeKey] = useState<string | null>(
    null
  );
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);

  // In-place title editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  // In-place configured date editing state (stays strictly YYYY-MM-DD)
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(
    null
  );
  const [editingDateValue, setEditingDateValue] = useState<string>('');

  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [isShiftDrag, setIsShiftDrag] = useState<boolean>(false);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [isMiniMode, setIsMiniMode] = useState<boolean>(false);
  const [dockCorner, setDockCorner] = useState<string>('bottom-left');
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const inlineEditInputRef = useRef<HTMLInputElement | null>(null);
  const inlineDateInputRef = useRef<HTMLInputElement | null>(null);
  const mutationBusy = useRef(false);
  const confirmedEvents = useRef<StoredEvent[]>([]);
  const editGroup = useRef('');
  const databaseIdentity = useRef('');
  const editDatabase = useRef('');
  const mutate = async (operation: () => Promise<StoredEvent[]>): Promise<StoredEvent[] | null> => {
    if (mutationBusy.current) return null;
    mutationBusy.current = true;
    const database = databaseIdentity.current;
    try {
      const updated = await operation();
      if (database !== databaseIdentity.current) throw new Error('Datenbank wurde gewechselt');
      confirmedEvents.current = updated;
      setEvents(updated);
      return updated;
    } catch (error) {
      pushToast(String(error), 'warning');
      return null;
    } finally { mutationBusy.current = false; }
  };

  const pushToast = (
    message: string,
    tone: 'info' | 'warning' | 'success' = 'info'
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  };

  useEffect(() => {
    eventBridge.getEvents().then(updated => { confirmedEvents.current = updated; setEvents(updated); }).catch(error => pushToast(String(error), 'warning'));
    eventBridge.getSettings().then((s) => {
      databaseIdentity.current = s.activeDatabasePath;
      setAppSettings(s);
      if (s.dockCorner) {
        setDockCorner(s.dockCorner);
      }
      if (!s.databaseReady) {
        setShowSettingsModal(true);
      } else if (s.bootMinimized) {
        setIsMiniMode(true);
        eventBridge.enterMiniMode('', 4).then((resolved) => {
          if (resolved) setDockCorner(resolved);
        });
      }
    });
    const unsubMinimize = eventBridge.onWindowMinimized(() => {
      setIsMiniMode(true);
    });
    const unsubRestore = eventBridge.onWindowRestored(() => {
      setIsMiniMode(false);
    });
    const unsubCorner = eventBridge.onWindowCornerChanged((corner) => {
      setDockCorner(corner);
    });
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      unsubMinimize();
      unsubRestore();
      unsubCorner();
      clearInterval(interval);
    };
  }, []);

  const state = useMemo(() => projectEvents(events, now), [events, now]);

  const miniTasks = useMemo(
    () => computeMiniWindowTasks(state.openTasks, now),
    [state.openTasks, now]
  );

  useEffect(() => {
    eventBridge.updateMiniModeHeight(miniTasks.length);
  }, [miniTasks.length]);

  const highlights = useMemo(
    () => computeDependencyHighlights(selectedTaskId, state.tasks),
    [selectedTaskId, state.tasks]
  );

  // Ordered predecessor chip keys (`predId->taskId`) in List View for Windows-style Shift+Click range selection
  const listOrderedEdgeKeys = useMemo(() => {
    const keys: string[] = [];
    for (const entry of state.listEntries) {
      if (entry.kind === 'task') {
        for (const predId of entry.task.predecessorIds) {
          keys.push(`${predId}->${entry.task.id}`);
        }
      }
    }
    return keys;
  }, [state.listEntries]);

  const clearEdgeSelection = () => {
    setSelectedEdgeKeys([]);
    setLastClickedEdgeKey(null);
  };

  const handleSelectEdgeWithModifiers = (
    edgeKey: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    orderedEdgeKeys: string[]
  ) => {
    setSelectedTaskId(null);
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (
      isShift &&
      lastClickedEdgeKey &&
      orderedEdgeKeys.includes(lastClickedEdgeKey) &&
      orderedEdgeKeys.includes(edgeKey)
    ) {
      const idxA = orderedEdgeKeys.indexOf(lastClickedEdgeKey);
      const idxB = orderedEdgeKeys.indexOf(edgeKey);
      const start = Math.min(idxA, idxB);
      const end = Math.max(idxA, idxB);
      const rangeKeys = orderedEdgeKeys.slice(start, end + 1);
      if (isCtrl) {
        setSelectedEdgeKeys((prev) =>
          Array.from(new Set([...prev, ...rangeKeys]))
        );
      } else {
        setSelectedEdgeKeys(rangeKeys);
      }
      return;
    }

    if (isCtrl) {
      setSelectedEdgeKeys((prev) =>
        prev.includes(edgeKey)
          ? prev.filter((k) => k !== edgeKey)
          : [...prev, edgeKey]
      );
      setLastClickedEdgeKey(edgeKey);
      return;
    }

    setSelectedEdgeKeys((prev) => {
      if (prev.length === 1 && prev[0] === edgeKey) {
        setLastClickedEdgeKey(null);
        return [];
      }
      setLastClickedEdgeKey(edgeKey);
      return [edgeKey];
    });
  };

  // Focus inline title input when editing starts
  useEffect(() => {
    if (editingTaskId && inlineEditInputRef.current) {
      inlineEditInputRef.current.focus();
      inlineEditInputRef.current.select();
    }
  }, [editingTaskId]);

  // Focus inline date input when date editing starts
  useEffect(() => {
    if (editingDateTaskId && inlineDateInputRef.current) {
      inlineDateInputRef.current.focus();
      inlineDateInputRef.current.select();
    }
  }, [editingDateTaskId]);

  // Close context menu on outside click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey
      ) {
        if (!isInputFocused) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        if (!isInputFocused) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      if (e.key === 'Shift') {
        setIsShiftDrag(true);
        if (draggedTaskId && selectedTaskId !== draggedTaskId) {
          setSelectedTaskId(draggedTaskId);
          clearEdgeSelection();
        }
      }

      if (isInputFocused) return;

      if (e.key === 'Escape') {
        setSelectedTaskId(null);
        clearEdgeSelection();
        setContextMenu(null);
        setShowShortcutsModal(false);
        return;
      }

      // Delete or Backspace on selected edges / predecessor labels removes all selected dependencies
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedEdgeKeys.length > 0
      ) {
        e.preventDefault();
        handleRemoveSelectedEdges(selectedEdgeKeys);
        return;
      }

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newTaskInputRef.current?.focus();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal((v) => !v);
        return;
      }

      const taskOrder = state.listEntries
        .filter((entry) => entry.kind === 'task')
        .map((entry) => (entry.kind === 'task' ? entry.task.id : ''));

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (taskOrder.length === 0) return;
        clearEdgeSelection();
        if (!selectedTaskId) {
          setSelectedTaskId(taskOrder[0]);
        } else {
          const idx = taskOrder.indexOf(selectedTaskId);
          const nextIdx = Math.min(taskOrder.length - 1, idx + 1);
          setSelectedTaskId(taskOrder[nextIdx]);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (taskOrder.length === 0) return;
        clearEdgeSelection();
        if (!selectedTaskId) {
          setSelectedTaskId(taskOrder[taskOrder.length - 1]);
        } else {
          const idx = taskOrder.indexOf(selectedTaskId);
          const prevIdx = Math.max(0, idx - 1);
          setSelectedTaskId(taskOrder[prevIdx]);
        }
        return;
      }

      if (!selectedTaskId || !state.tasks[selectedTaskId]) return;
      const selTask = state.tasks[selectedTaskId];

      if (e.key === ' ' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleToggleActive(selTask);
        return;
      }

      if (e.key === 'F2' || e.key.toLowerCase() === 'e' || e.key === 'Enter') {
        e.preventDefault();
        startInlineEdit(selTask);
        return;
      }

      if (e.key === 'Delete' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleCompleteTask(selTask.id);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftDrag(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedTaskId, selectedEdgeKeys, draggedTaskId, state]);

  // Actions
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;

    if (mutationBusy.current) return;
    const taskId = projectEvents(confirmedEvents.current, new Date()).nextTaskId;
    setLastMovedKey(`task:${taskId}`);
    const updated = await mutate(() => eventBridge.appendEvent('TASK_CREATED', {
      taskId,
      title: trimmed,
      configuredStart: now.toISOString(),
      createdAt: now.toISOString(),
    }));
    if (!updated) return;
    setNewTaskTitle(current => current.trim() === trimmed ? '' : current);
    setSelectedTaskId(taskId);
  };

  const startInlineEdit = (task: TaskState) => {
    editDatabase.current = databaseIdentity.current;
    editGroup.current = crypto.randomUUID();
    setEditingDateTaskId(null);
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    setContextMenu(null);
  };

  const commitInlineEdit = async () => {
    if (editDatabase.current !== databaseIdentity.current) return;
    if (!editingTaskId) return;
    const task = state.tasks[editingTaskId];
    const trimmed = editingTitle.trim();
    if (!task || !trimmed || trimmed === task.title) { setEditingTaskId(null); return; }

    const updated = await mutate(() => eventBridge.appendEvent('TASK_RENAMED', {
      taskId: task.id,
      title: trimmed,
    }, editGroup.current));
    if (updated) setEditingTaskId(null);
  };

  const startInlineDateEdit = (task: TaskState) => {
    editDatabase.current = databaseIdentity.current;
    editGroup.current = crypto.randomUUID();
    setEditingTaskId(null);
    setEditingDateTaskId(task.id);
    const { isoText } = formatIso8601Display(task.configuredStart);
    setEditingDateValue(isoText);
    setContextMenu(null);
  };

  const commitInlineDateEdit = async () => {
    if (editDatabase.current !== databaseIdentity.current) return;
    if (!editingDateTaskId) return;
    const task = state.tasks[editingDateTaskId];
    const currentInput = editingDateValue;
    if (!task) return;

    const parsedIso = normalizeUserDate(currentInput, now);
    if (Date.parse(task.configuredStart) === Date.parse(parsedIso)) { setEditingDateTaskId(null); return; }

    setLastMovedKey(`task:${task.id}`);
    const updated = await mutate(() => eventBridge.appendEvent('TASK_START_DATE_SET', {
      taskId: task.id,
      configuredStart: parsedIso,
    }, editGroup.current));
    if (updated) setEditingDateTaskId(null);
  };

  const handleToggleActive = async (task: TaskState) => {
    if (task.predecessorIds.length > 0) {
      pushToast(
        `Task ${task.id} hat noch offene Vorgänger und kann nicht aktiviert werden.`,
        'warning'
      );
      return;
    }
    const nextActive = !task.isActive;
    await mutate(() => eventBridge.appendEvent('TASK_ACTIVE_SET', {
      taskId: task.id,
      isActive: nextActive,
    }));
  };

  const handleSetConfiguredDate = async (
    taskId: string,
    isoDate: string,
    humanLabel: string
  ) => {
    setLastMovedKey(`task:${taskId}`);
    if (!state.tasks[taskId]) return;
    const updated = await mutate(() => eventBridge.appendEvent('TASK_START_DATE_SET', {
      taskId,
      configuredStart: normalizeUserDate(formatIso8601Display(isoDate).isoText, now),
    }));
    if (!updated) return;
    pushToast(`Startdatum von ${taskId} → ${humanLabel}`, 'info');
  };

  const handleAddPredecessor = async (
    draggedId: string,
    targetTaskId: string
  ) => {
    if (draggedId === targetTaskId) return;
    const draggedTask = state.tasks[draggedId];
    const targetTask = state.tasks[targetTaskId];
    if (!draggedTask || !targetTask) return;

    if (draggedTask.predecessorIds.includes(targetTaskId)) {
      return;
    }

    const targetHighlights = computeDependencyHighlights(
      targetTaskId,
      state.tasks
    );
    if (
      targetHighlights[draggedId] === 'predecessor-direct' ||
      targetHighlights[draggedId] === 'predecessor-transitive'
    ) {
      pushToast(
        `Zyklus verhindert: ${draggedId} ist bereits Vorgänger von ${targetTaskId}`,
        'warning'
      );
      return;
    }

    setLastMovedKey(`task:${draggedId}`);
    const updated = await mutate(() => eventBridge.appendEvent('DEPENDENCY_ADDED', {
      taskId: draggedId,
      predecessorId: targetTaskId,
    }));
    if (!updated) return;
    setSelectedTaskId(draggedId);
  };

  const handleRemovePredecessor = async (
    taskId: string,
    predecessorId: string
  ) => {
    setLastMovedKey(`task:${taskId}`);
    await mutate(() => eventBridge.appendEvent('DEPENDENCY_REMOVED', {
      taskId,
      predecessorId,
    }));
  };

  const handleRemoveSelectedEdges = async (edgeKeysToRemove: string[]) => {
    if (edgeKeysToRemove.length === 0) return;
    const commands = edgeKeysToRemove.map(key => {
      const [from, to] = key.split('->');
      return { type: 'DEPENDENCY_REMOVED' as const, payload: { taskId: to, predecessorId: from } };
    });
    const updated = await mutate(() => eventBridge.appendBatch(commands));
    if (!updated) return;
    clearEdgeSelection();
    pushToast(
      edgeKeysToRemove.length === 1
        ? `Kante ${edgeKeysToRemove[0].replace('->', ' → ')} gelöscht`
        : `${edgeKeysToRemove.length} Kanten gelöscht`,
      'info'
    );
  };

  /**
   * Shift-Drag removes the dependency between `draggedId` and `targetTaskId`.
   * Because Shift-Drag selects `draggedId`, `highlights` already knows whether `targetTaskId`
   * is a predecessor or successor (and cycles are prevented on creation, so only one direction can exist).
   */
  const handleRemoveDependencyBetween = async (
    draggedId: string,
    targetTaskId: string
  ) => {
    if (draggedId === targetTaskId) return;
    const draggedTask = state.tasks[draggedId];
    const targetTask = state.tasks[targetTaskId];
    if (!draggedTask || !targetTask) return;

    const targetRole = highlights[targetTaskId];

    if (
      targetRole === 'predecessor-direct' ||
      draggedTask.allPredecessorIds.includes(targetTaskId)
    ) {
      await handleRemovePredecessor(draggedId, targetTaskId);
      pushToast(`Kante ${targetTaskId} → ${draggedId} gelöscht`, 'info');
      return;
    }

    if (
      targetRole === 'successor-direct' ||
      targetTask.allPredecessorIds.includes(draggedId)
    ) {
      await handleRemovePredecessor(targetTaskId, draggedId);
      pushToast(`Kante ${draggedId} → ${targetTaskId} gelöscht`, 'info');
      return;
    }

    pushToast(
      `Keine direkte Kante zwischen ${draggedId} und ${targetTaskId}`,
      'warning'
    );
  };

  const handleCompleteTask = async (taskId: string) => {
    const updated = await mutate(() => eventBridge.appendEvent('TASK_COMPLETED', {
      taskId,
      completedAt: new Date().toISOString(),
    }));
    if (!updated) return;
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  };

  const handleReopenTask = async (taskId: string) => {
    setLastMovedKey(`task:${taskId}`);
    await mutate(() => eventBridge.appendEvent('TASK_REOPENED', {
      taskId,
    }));
  };

  const handleUndo = async () => {
    if (!state.canUndo) return;
    await mutate(() => eventBridge.undo());
  };

  const handleRedo = async () => {
    if (!state.canRedo) return;
    await mutate(() => eventBridge.redo());
  };

  const handleCloseSettingsModal = () => {
    if (!appSettings?.databaseReady) return;
    setShowSettingsModal(false);
  };

  const changeDatabase = async (operation: () => Promise<AppSettings>) => {
    if (mutationBusy.current) throw new Error('Eine Aenderung wird noch gespeichert');
    mutationBusy.current = true;
    try {
      const settings = await operation();
      databaseIdentity.current = settings.activeDatabasePath;
      setAppSettings(settings);
      const updated = await eventBridge.getEvents();
      confirmedEvents.current = updated;
      setEvents(updated);
      setEditingTaskId(null); setEditingDateTaskId(null); editGroup.current = ''; editDatabase.current = '';
      setNewTaskTitle(''); setSelectedTaskId(null); setContextMenu(null); clearEdgeSelection();
      return settings;
    } finally { mutationBusy.current = false; }
  };

  const handleCreateDatabase = async (folderPath: string, dbName: string, seedDemo: boolean) => {
    await changeDatabase(() => eventBridge.createDatabase(folderPath, dbName, seedDemo));
    pushToast(`Datenbank „${dbName}“ angelegt und aktiviert`, 'success');
  };

  const handleOpenExistingDatabase = async () => {
    const prevPath = appSettings?.activeDatabasePath;
    const updatedSettings = await changeDatabase(() => eventBridge.openExistingDatabaseDialog());
    if (updatedSettings.activeDatabasePath !== prevPath) {
      setSelectedTaskId(null);
      clearEdgeSelection();
      pushToast('Datenbank geöffnet und aktiviert', 'success');
    }
  };

  const handleSwitchDatabase = async (dbPath: string) => {
    const updatedSettings = await changeDatabase(() => eventBridge.switchDatabase(dbPath));
    setSelectedTaskId(null);
    clearEdgeSelection();
    const activeEntry = updatedSettings.knownDatabases.find(
      (d) => d.path.toLowerCase() === dbPath.toLowerCase()
    );
    pushToast(
      `Datenbank „${activeEntry?.name || dbPath}“ geladen`,
      'info'
    );
  };

  const handleDeleteDatabase = async (dbPath: string, deleteFile: boolean) => {
    const targetEntry = appSettings?.knownDatabases.find(
      (d) => d.path.toLowerCase() === dbPath.toLowerCase()
    );
    const updatedSettings = await changeDatabase(() => eventBridge.deleteDatabase(dbPath, deleteFile));
    setSelectedTaskId(null);
    clearEdgeSelection();
    if (!updatedSettings.databaseReady) {
      setShowSettingsModal(true);
    }
    pushToast(
      `Datenbank „${targetEntry?.name || dbPath}“ ${deleteFile ? 'geloescht' : 'aus Liste entfernt'}`,
      'warning'
    );
  };

  const handleToggleAutostart = async (enabled: boolean) => {
    const updatedSettings = await eventBridge.setAutostart(enabled);
    setAppSettings(updatedSettings);
    pushToast(
      enabled
        ? 'Autostart beim Windows-Booten aktiviert'
        : 'Autostart beim Windows-Booten deaktiviert',
      'info'
    );
  };

  const handleEnterMiniMode = async () => {
    setIsMiniMode(true);
    const resolved = await eventBridge.enterMiniMode('', miniTasks.length);
    if (resolved) setDockCorner(resolved);
  };

  const handleRestoreFromMiniMode = async (selectTaskId?: string) => {
    setIsMiniMode(false);
    if (selectTaskId) {
      setSelectedTaskId(selectTaskId);
      clearEdgeSelection();
    }
    await eventBridge.exitMiniMode();
  };

  // Drag handlers
  const onDragStartTask = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'all';
    if (e.shiftKey) {
      setIsShiftDrag(true);
      setSelectedTaskId(taskId);
      clearEdgeSelection();
    } else {
      setIsShiftDrag(false);
    }
  };

  const onDragEndTask = () => {
    setDraggedTaskId(null);
    setIsShiftDrag(false);
    setActiveDropTargetKey(null);
  };

  if (isMiniMode) {
    return (
      <MiniCornerView
        tasks={miniTasks}
        onSelectAndRestore={(taskId) => handleRestoreFromMiniMode(taskId)}
        onRestoreWindow={() => handleRestoreFromMiniMode()}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white/90 backdrop-blur-md z-20 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-sm shadow-sky-500/20">
              <GitBranch className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">
              DoDrag
            </h1>
          </div>

          {/* View Switcher: Liste vs. Netzplan vs. Gantt */}
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Liste</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('network')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'network'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Netzplan</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('gantt')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'gantt'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Gantt</span>
            </button>
          </div>
        </div>

        {/* Quick Task Creation Bar */}
        <form onSubmit={handleCreateTask} className="flex-1 max-w-md mx-6">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-xs font-mono font-medium text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
              {state.nextTaskId}
            </span>
            <input
              ref={newTaskInputRef}
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Neues kleines TODO eingeben... (Taste N)"
              className="w-full pl-20 pr-9 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all"
            />
            <button
              type="submit"
              title="Task hinzufügen (Enter)"
              className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Undo/Redo & Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1">
            <button
              onClick={handleUndo}
              disabled={!state.canUndo}
              title="Rückgängig (Ctrl+Z)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
            <div className="w-px h-4 bg-slate-300 mx-0.5" />
            <button
              onClick={handleRedo}
              disabled={!state.canRedo}
              title="Wiederherstellen (Ctrl+Y)"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
              <span>Redo</span>
            </button>
          </div>

          <button
            onClick={async () => {
              try { setAppSettings(await eventBridge.getSettings()); setShowSettingsModal(true); }
              catch (error) { pushToast(String(error), 'warning'); }
            }}
            title="Einstellungen & Datenbanken"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={handleEnterMiniMode}
            title="Minimieren (Kompaktansicht in Bildschirmecke)"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowShortcutsModal(true)}
            title="Tastenkürzel & Bedienung (?)"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50 transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area: Liste / Netzplan (Left, mouse-wheel scrollable) + Sidebar (Right) */}
      <div className="flex-1 flex overflow-hidden">
        <main
          className="flex-1 overflow-y-auto overflow-x-auto px-6 py-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTaskId(null);
              clearEdgeSelection();
            }
          }}
        >
          {viewMode === 'list' ? (
            <SmoothFlipList
              movedItemKey={lastMovedKey}
              className="max-w-3xl mx-auto space-y-2 pb-16"
            >
              {state.listEntries.map((entry) => {
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
                        const tId =
                          draggedTaskId || e.dataTransfer.getData('text/plain');
                        setActiveDropTargetKey(null);
                        setDraggedTaskId(null);
                        if (tId) {
                          handleSetConfiguredDate(
                            tId,
                            entry.isoDate,
                            entry.dateKey
                          );
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
                  activeDropTargetKey === entry.key &&
                  draggedTaskId !== task.id;
                const isEditing = editingTaskId === task.id;
                const isEditingDate = editingDateTaskId === task.id;
                const confDisplay = formatIso8601Display(task.configuredStart);

                let containerClasses =
                  'bg-white border-slate-200/90 shadow-sm hover:border-slate-300';

                if (isDropTarget) {
                  containerClasses = isShiftDrag
                    ? 'bg-rose-50 border-rose-500 ring-2 ring-rose-400/35 shadow-md'
                    : 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-md';
                } else if (role === 'selected') {
                  containerClasses =
                    'bg-sky-100/90 border-sky-500 ring-2 ring-sky-400/35 shadow-sm';
                } else if (
                  role === 'predecessor-direct' ||
                  role === 'predecessor-transitive'
                ) {
                  containerClasses =
                    'bg-amber-100/85 border-amber-500 ring-2 ring-amber-400/30 shadow-sm';
                } else if (
                  role === 'successor-direct' ||
                  role === 'successor-transitive'
                ) {
                  containerClasses =
                    'bg-purple-100/85 border-purple-500 ring-2 ring-purple-400/30 shadow-sm';
                } else if (task.isActive) {
                  containerClasses =
                    'bg-emerald-100/90 border-emerald-500 ring-2 ring-emerald-500/25 shadow-sm';
                } else if (task.isWaitingOrFuture) {
                  containerClasses =
                    'bg-white/60 border-slate-200/60 opacity-50 hover:opacity-85';
                }

                return (
                  <div
                    key={entry.key}
                    data-flip-key={entry.key}
                    draggable={!isEditing && !isEditingDate}
                    onMouseDown={(e) => {
                      if (e.shiftKey) {
                        setIsShiftDrag(true);
                        if (selectedTaskId !== task.id) {
                          setSelectedTaskId(task.id);
                          clearEdgeSelection();
                        }
                      }
                    }}
                    onDragStart={(e) => onDragStartTask(e, task.id)}
                    onDragEnd={onDragEndTask}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.shiftKey !== isShiftDrag) {
                        setIsShiftDrag(e.shiftKey);
                        if (
                          e.shiftKey &&
                          draggedTaskId &&
                          selectedTaskId !== draggedTaskId
                        ) {
                          setSelectedTaskId(draggedTaskId);
                          clearEdgeSelection();
                        }
                      }
                      if (draggedTaskId && draggedTaskId !== task.id) {
                        e.dataTransfer.dropEffect = 'move';
                        if (activeDropTargetKey !== entry.key) {
                          setActiveDropTargetKey(entry.key);
                        }
                      }
                    }}
                    onDragLeave={() => {
                      if (activeDropTargetKey === entry.key) {
                        setActiveDropTargetKey(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const sourceId =
                        draggedTaskId || e.dataTransfer.getData('text/plain');
                      const shiftHeld = e.shiftKey || isShiftDrag;
                      setActiveDropTargetKey(null);
                      setDraggedTaskId(null);
                      setIsShiftDrag(false);
                      if (sourceId && sourceId !== task.id) {
                        if (shiftHeld) {
                          handleRemoveDependencyBetween(sourceId, task.id);
                        } else {
                          handleAddPredecessor(sourceId, task.id);
                        }
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      clearEdgeSelection();
                      setSelectedTaskId((prev) =>
                        prev === task.id ? null : task.id
                      );
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearEdgeSelection();
                      setSelectedTaskId(task.id);
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        taskId: task.id,
                      });
                    }}
                    className={`group relative flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-colors cursor-pointer ${containerClasses} ${
                      isBeingDragged ? 'opacity-35' : ''
                    }`}
                  >
                    {/* Left section: Drag Handle + Active Toggle + Task ID + In-place Editable Title */}
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div
                        title="Ziehen auf Task (= Vorgänger setzen), Shift-Ziehen (= Kante löschen), auf Datum oder Wiedervorlage rechts"
                        className="text-slate-400 group-hover:text-slate-600 cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>

                      {task.predecessorIds.length === 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleActive(task);
                          }}
                          title={
                            task.isActive
                              ? 'Deaktivieren (Space)'
                              : 'Aktivieren (Space)'
                          }
                          className={`p-1 rounded-lg border transition-all ${
                            task.isActive
                              ? 'bg-emerald-500 text-white border-emerald-600 shadow-sm'
                              : 'bg-slate-100 border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-300'
                          }`}
                        >
                          <Flame className="w-3.5 h-3.5" />
                        </button>
                      )}

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

                      {isEditing ? (
                        <input
                          ref={inlineEditInputRef}
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={commitInlineEdit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitInlineEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingTaskId(null);
                            }
                          }}
                          className="flex-1 bg-white border border-sky-500 rounded-lg px-2.5 py-0.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                        />
                      ) : (
                        <span
                          onClick={(e) => {
                            if (selectedTaskId === task.id) {
                              e.stopPropagation();
                              startInlineEdit(task);
                            }
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startInlineEdit(task);
                          }}
                          title="Klick (wenn ausgewählt) oder Doppelklick / F2 zum Bearbeiten"
                          className={`text-sm truncate px-1.5 py-0.5 -mx-1.5 rounded hover:bg-black/5 transition-colors ${
                            task.isActive
                              ? 'font-semibold text-emerald-950'
                              : task.isWaitingOrFuture && !role
                              ? 'text-slate-600'
                              : 'text-slate-900 font-medium'
                          }`}
                        >
                          {task.title}
                        </span>
                      )}
                    </div>

                    {/* Right section: Selectable Predecessor chips (Ctrl/Shift multi-select, Del/Backspace) & In-Place Editable Configured Date */}
                    <div className="flex items-center gap-2 shrink-0">
                      {task.predecessorIds.length > 0 && (
                        <div className="flex items-center gap-1">
                          {task.predecessorIds.map((predId) => {
                            const edgeKey = `${predId}->${task.id}`;
                            const isChipSelected =
                              selectedEdgeKeys.includes(edgeKey);
                            return (
                              <button
                                key={predId}
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectEdgeWithModifiers(
                                    edgeKey,
                                    e,
                                    listOrderedEdgeKeys
                                  );
                                }}
                                title={`Vorgänger ${predId} (Klick / Strg+Klick / Shift+Klick zum Auswählen, Entf/Backspace zum Löschen)`}
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

                      <div
                        className="flex items-center text-[11px] font-mono"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isEditingDate ? (
                          <input
                            ref={inlineDateInputRef}
                            type="text"
                            value={editingDateValue}
                            placeholder="JJJJ-MM-TT"
                            onChange={(e) =>
                              setEditingDateValue(e.target.value)
                            }
                            onBlur={commitInlineDateEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitInlineDateEdit();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingDateTaskId(null);
                              }
                            }}
                            className="w-28 px-2 py-0.5 rounded border border-sky-500 bg-white text-slate-900 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startInlineDateEdit(task);
                            }}
                            title="Klicken zum Bearbeiten (JJJJ-MM-TT)"
                            className={`px-2 py-0.5 rounded border transition-colors hover:border-sky-400 hover:bg-sky-50/60 ${
                              confDisplay.isWeekend
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100/90 text-slate-600 border-slate-200'
                            }`}
                          >
                            {confDisplay.isoText}{' '}
                            <span
                              className={
                                confDisplay.isWeekend
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-400'
                              }
                            >
                              ({confDisplay.weekdayShort})
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </SmoothFlipList>
          ) : viewMode === 'network' ? (
            <NetworkPlanView
              openTasks={state.openTasks}
              now={now}
              selectedTaskId={selectedTaskId}
              selectedEdgeKeys={selectedEdgeKeys}
              onSelectEdge={handleSelectEdgeWithModifiers}
              onClearEdgeSelection={clearEdgeSelection}
              highlights={highlights}
              draggedTaskId={draggedTaskId}
              isShiftDrag={isShiftDrag}
              onShiftKeyChange={(shift) => {
                setIsShiftDrag(shift);
                if (shift && draggedTaskId && selectedTaskId !== draggedTaskId) {
                  setSelectedTaskId(draggedTaskId);
                  clearEdgeSelection();
                }
              }}
              activeDropTargetKey={activeDropTargetKey}
              setActiveDropTargetKey={setActiveDropTargetKey}
              setDraggedTaskId={setDraggedTaskId}
              onSelectTask={(taskId) => {
                clearEdgeSelection();
                setSelectedTaskId((prev) => (prev === taskId ? null : taskId));
              }}
              onContextMenuTask={(e, taskId) => {
                e.preventDefault();
                e.stopPropagation();
                clearEdgeSelection();
                setSelectedTaskId(taskId);
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  taskId,
                });
              }}
              onDragStartTask={onDragStartTask}
              onDragEndTask={onDragEndTask}
              onAddPredecessor={handleAddPredecessor}
              onRemoveDependencyBetween={handleRemoveDependencyBetween}
              onSetConfiguredDate={handleSetConfiguredDate}
              onToggleActive={handleToggleActive}
            />
          ) : (
            <GanttView
              openTasks={state.openTasks}
              listEntries={state.listEntries}
              now={now}
              selectedTaskId={selectedTaskId}
              selectedEdgeKeys={selectedEdgeKeys}
              onSelectEdge={handleSelectEdgeWithModifiers}
              onClearEdgeSelection={clearEdgeSelection}
              highlights={highlights}
              draggedTaskId={draggedTaskId}
              isShiftDrag={isShiftDrag}
              onShiftKeyChange={(shift) => {
                setIsShiftDrag(shift);
                if (shift && draggedTaskId && selectedTaskId !== draggedTaskId) {
                  setSelectedTaskId(draggedTaskId);
                  clearEdgeSelection();
                }
              }}
              activeDropTargetKey={activeDropTargetKey}
              setActiveDropTargetKey={setActiveDropTargetKey}
              setDraggedTaskId={setDraggedTaskId}
              onSelectTask={(taskId) => {
                clearEdgeSelection();
                setSelectedTaskId((prev) => (prev === taskId ? null : taskId));
              }}
              onContextMenuTask={(e, taskId) => {
                e.preventDefault();
                e.stopPropagation();
                clearEdgeSelection();
                setSelectedTaskId(taskId);
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  taskId,
                });
              }}
              onDragStartTask={onDragStartTask}
              onDragEndTask={onDragEndTask}
              onAddPredecessor={handleAddPredecessor}
              onRemoveDependencyBetween={handleRemoveDependencyBetween}
              onSetConfiguredDate={handleSetConfiguredDate}
              onToggleActive={handleToggleActive}
            />
          )}
        </main>

        {/* Right Sidebar: Wiedervorlage Drag-Targets + Permanent "Erledigte Tasks" List (Drop Target) */}
        <aside className="w-80 border-l border-slate-200 bg-white/90 p-4 flex flex-col gap-4 shrink-0 overflow-hidden">
          <div className="space-y-2 shrink-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">
              Wiedervorlage
            </h2>

            <div className="space-y-1.5">
              {RESUBMIT_TARGETS.map((target) => {
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
                      setActiveDropTargetKey(null);
                      setDraggedTaskId(null);
                      if (tId) {
                        const targetIso = calculateQuickResubmitDate(
                          target.id,
                          new Date()
                        );
                        handleSetConfiguredDate(tId, targetIso, target.label);
                      }
                    }}
                    onClick={() => {
                      if (selectedTaskId) {
                        const targetIso = calculateQuickResubmitDate(
                          target.id,
                          new Date()
                        );
                        handleSetConfiguredDate(
                          selectedTaskId,
                          targetIso,
                          target.label
                        );
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
                        {target.icon}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-800">
                          {target.label}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {target.sublabel}
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
              const tId =
                draggedTaskId || e.dataTransfer.getData('text/plain');
              setActiveDropTargetKey(null);
              setDraggedTaskId(null);
              if (tId) {
                handleCompleteTask(tId);
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
                Erledigte Tasks ({state.completedTasks.length})
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {state.completedTasks.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-slate-400 text-center px-3">
                  Tasks hierher ziehen, um sie als erledigt abzulegen
                </div>
              ) : (
                state.completedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-xs shadow-2xs"
                  >
                    <div className="truncate min-w-0">
                      <span className="font-mono text-[11px] text-slate-400 mr-1.5">
                        {t.id}
                      </span>
                      <span className="line-through text-slate-500">
                        {t.title}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReopenTask(t.id)}
                      title="Task wieder öffnen"
                      className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-600 shrink-0"
                    >
                      Öffnen
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && state.tasks[contextMenu.taskId] && (
        <div
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 260),
            left: Math.min(contextMenu.x, window.innerWidth - 260),
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-64 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 text-xs text-slate-700"
        >
          <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <span className="font-mono font-semibold text-sky-700">
              Task {contextMenu.taskId}
            </span>
            <span className="text-[10px] text-slate-400 truncate max-w-[130px]">
              {state.tasks[contextMenu.taskId].title}
            </span>
          </div>

          <button
            onClick={() => {
              const t = state.tasks[contextMenu.taskId];
              setContextMenu(null);
              handleToggleActive(t);
            }}
            disabled={state.tasks[contextMenu.taskId].predecessorIds.length > 0}
            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="flex items-center gap-2">
              <Flame className="w-3.5 h-3.5 text-emerald-600" />
              {state.tasks[contextMenu.taskId].isActive
                ? 'Deaktivieren'
                : 'Aktivieren (Hervorheben)'}
            </span>
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
              Space
            </kbd>
          </button>

          <button
            onClick={() => startInlineEdit(state.tasks[contextMenu.taskId])}
            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
          >
            <span>Titel bearbeiten (In-Place)</span>
            <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
              F2
            </kbd>
          </button>

          <button
            onClick={() => {
              const tId = contextMenu.taskId;
              setContextMenu(null);
              handleSetConfiguredDate(tId, new Date().toISOString(), 'Heute');
            }}
            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
          >
            <span>Startdatum auf Heute setzen</span>
          </button>

          {state.tasks[contextMenu.taskId].predecessorIds.length > 0 && (
            <div className="border-t border-slate-100 mt-1 pt-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">
                Vorgänger entfernen
              </div>
              {state.tasks[contextMenu.taskId].predecessorIds.map((predId) => (
                <button
                  key={predId}
                  onClick={() => {
                    const tId = contextMenu.taskId;
                    setContextMenu(null);
                    handleRemovePredecessor(tId, predId);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-amber-50 flex items-center gap-2 text-amber-800"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  <span>Vorgänger {predId} lösen</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              onClick={() => {
                const tId = contextMenu.taskId;
                setContextMenu(null);
                handleCompleteTask(tId);
              }}
              className="w-full px-3 py-2 text-left hover:bg-emerald-50 text-emerald-700 flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Als erledigt markieren
              </span>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-600">
                Del
              </kbd>
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      <AnimatePresence>
        {showShortcutsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowShortcutsModal(false)}
            className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Tastenkürzel &amp; Drag-and-Drop Steuerung
                </h3>
                <button
                  onClick={() => setShowShortcutsModal(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Task aktivieren / deaktivieren (ohne Vorgänger)</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    Space / A / Rechtsklick
                  </kbd>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Task in-place umbenennen</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    F2 / Enter / Doppelklick
                  </kbd>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Neuen Task erstellen</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    N
                  </kbd>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Ausgewählten Task erledigen</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    Del / D
                  </kbd>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span>Undo / Redo</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    Ctrl+Z / Ctrl+Y
                  </kbd>
                </div>
                <div className="flex justify-between py-1">
                  <span>Navigation durch Tasks</span>
                  <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                    ↑ / ↓ / Esc
                  </kbd>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings & Database Management Modal */}
      {showSettingsModal && appSettings && (
        <SettingsModal
          settings={appSettings}
          onClose={handleCloseSettingsModal}
          onSelectFolder={() => eventBridge.selectFolderDialog()}
          onCreateDatabase={handleCreateDatabase}
          onOpenExistingDatabase={handleOpenExistingDatabase}
          onSwitchDatabase={handleSwitchDatabase}
          onDeleteDatabase={handleDeleteDatabase}
          onToggleAutostart={handleToggleAutostart}
        />
      )}

      {/* Floating Toasts */}
      <div className="fixed bottom-4 left-6 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              className={`px-3.5 py-2 rounded-xl border text-xs font-medium shadow-md backdrop-blur-md ${
                t.tone === 'warning'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : t.tone === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-white border-slate-200 text-slate-800'
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
