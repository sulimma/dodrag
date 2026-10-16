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
  History,
  Link2Off,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { eventBridge } from './bridge/eventBridge';
import { SmoothFlipList } from './components/SmoothFlipList';
import {
  calculateQuickResubmitDate,
  computeDependencyHighlights,
  dateKeyToIsoStart,
  formatIso8601Display,
  projectEvents,
  QuickResubmitTargetId,
  toDateKey,
} from './domain/projector';
import { HighlightRole, StoredEvent, TaskState } from './domain/types';

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

function parseUserDateInputToIso(input: string): string | null {
  const trimmed = input.trim();
  // Match YYYY-MM-DD or YYYY-MM-DD HH:mm
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(
    trimmed
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 9;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function App() {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [now, setNow] = useState<Date>(() => new Date());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [lastMovedKey, setLastMovedKey] = useState<string | null>(null);

  // In-place title editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  // In-place configured date editing state
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(
    null
  );
  const [editingDateValue, setEditingDateValue] = useState<string>('');

  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState<boolean>(false);
  const [showCompletedDrawer, setShowCompletedDrawer] =
    useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const inlineEditInputRef = useRef<HTMLInputElement | null>(null);
  const inlineDateInputRef = useRef<HTMLInputElement | null>(null);

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
    eventBridge.getEvents().then(setEvents);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const state = useMemo(() => projectEvents(events, now), [events, now]);

  const highlights = useMemo(
    () => computeDependencyHighlights(selectedTaskId, state.tasks),
    [selectedTaskId, state.tasks]
  );

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

      if (isInputFocused) return;

      if (e.key === 'Escape') {
        setSelectedTaskId(null);
        setContextMenu(null);
        setShowShortcutsModal(false);
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskId, state]);

  // Actions
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;

    const taskId = state.nextTaskId;
    setNewTaskTitle('');
    const updated = await eventBridge.appendEvent('TASK_CREATED', {
      taskId,
      title: trimmed,
      configuredStart: now.toISOString(),
      createdAt: now.toISOString(),
    });
    setEvents(updated);
    setSelectedTaskId(taskId);
  };

  const startInlineEdit = (task: TaskState) => {
    setEditingDateTaskId(null);
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    setContextMenu(null);
  };

  const commitInlineEdit = async () => {
    if (!editingTaskId) return;
    const task = state.tasks[editingTaskId];
    const trimmed = editingTitle.trim();
    setEditingTaskId(null);
    if (!task || !trimmed || trimmed === task.title) return;

    const updated = await eventBridge.appendEvent('TASK_RENAMED', {
      taskId: task.id,
      title: trimmed,
    });
    setEvents(updated);
  };

  const startInlineDateEdit = (task: TaskState) => {
    setEditingTaskId(null);
    setEditingDateTaskId(task.id);
    const { isoText } = formatIso8601Display(task.configuredStart);
    setEditingDateValue(isoText);
    setContextMenu(null);
  };

  const commitInlineDateEdit = async () => {
    if (!editingDateTaskId) return;
    const task = state.tasks[editingDateTaskId];
    const currentInput = editingDateValue;
    setEditingDateTaskId(null);
    if (!task) return;

    const parsedIso = parseUserDateInputToIso(currentInput);
    if (!parsedIso) {
      pushToast('Bitte gültiges ISO-Datum (YYYY-MM-DD) eingeben', 'warning');
      return;
    }

    const prevIsoText = formatIso8601Display(task.configuredStart).isoText;
    const nextIsoText = formatIso8601Display(parsedIso).isoText;
    if (prevIsoText === nextIsoText) return;

    setLastMovedKey(`task:${task.id}`);
    const updated = await eventBridge.appendEvent('TASK_START_DATE_SET', {
      taskId: task.id,
      configuredStart: parsedIso,
    });
    setEvents(updated);
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
    const updated = await eventBridge.appendEvent('TASK_ACTIVE_SET', {
      taskId: task.id,
      isActive: nextActive,
    });
    setEvents(updated);
  };

  const handleSetConfiguredDate = async (
    taskId: string,
    isoDate: string,
    humanLabel: string
  ) => {
    setLastMovedKey(`task:${taskId}`);
    const updated = await eventBridge.appendEvent('TASK_START_DATE_SET', {
      taskId,
      configuredStart: isoDate,
    });
    setEvents(updated);
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
    const updated = await eventBridge.appendEvent('DEPENDENCY_ADDED', {
      taskId: draggedId,
      predecessorId: targetTaskId,
    });
    setEvents(updated);
    setSelectedTaskId(draggedId);
  };

  const handleRemovePredecessor = async (
    taskId: string,
    predecessorId: string
  ) => {
    setLastMovedKey(`task:${taskId}`);
    const updated = await eventBridge.appendEvent('DEPENDENCY_REMOVED', {
      taskId,
      predecessorId,
    });
    setEvents(updated);
  };

  const handleCompleteTask = async (taskId: string) => {
    const updated = await eventBridge.appendEvent('TASK_COMPLETED', {
      taskId,
      completedAt: new Date().toISOString(),
    });
    setEvents(updated);
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  };

  const handleReopenTask = async (taskId: string) => {
    setLastMovedKey(`task:${taskId}`);
    const updated = await eventBridge.appendEvent('TASK_REOPENED', {
      taskId,
    });
    setEvents(updated);
  };

  const handleUndo = async () => {
    if (!state.canUndo) return;
    const updated = await eventBridge.undo();
    setEvents(updated);
  };

  const handleRedo = async () => {
    if (!state.canRedo) return;
    const updated = await eventBridge.redo();
    setEvents(updated);
  };

  const handleResetDemo = async () => {
    const updated = await eventBridge.resetDemoData();
    setEvents(updated);
    setSelectedTaskId(null);
  };

  // Drag handlers
  const onDragStartTask = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragEndTask = () => {
    setDraggedTaskId(null);
    setActiveDropTargetKey(null);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100/80 text-slate-800 select-none overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white/90 backdrop-blur-md z-20 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-sm shadow-sky-500/20">
            <GitBranch className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-base font-bold tracking-tight text-slate-900">
            DoDrag
          </h1>
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
            onClick={() => setShowCompletedDrawer((v) => !v)}
            title="Erledigte Tasks anzeigen"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              showCompletedDrawer
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Erledigt ({state.completedTasks.length})</span>
          </button>

          <button
            onClick={handleResetDemo}
            title="Demo-Daten zurücksetzen"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
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

      {/* Main Content Area: Topological List (Left) + Drag Targets Sidebar (Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Central Topological List */}
        <main
          className="flex-1 overflow-y-auto px-6 py-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedTaskId(null);
            }
          }}
        >
          <SmoothFlipList
            movedItemKey={lastMovedKey}
            className="max-w-3xl mx-auto space-y-2 pb-16"
          >
            {state.listEntries.map((entry) => {
              if (entry.kind === 'date') {
                const isDropActive = activeDropTargetKey === entry.key;
                return (
                  <div
                    key={entry.key}
                    data-flip-key={entry.key}
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
                    className={`group flex items-center justify-between px-3.5 py-1.5 mt-3.5 rounded-lg border transition-colors ${
                      isDropActive
                        ? 'bg-sky-100 border-sky-400 shadow-sm'
                        : entry.isWeekend
                        ? 'bg-amber-50/90 border-amber-200/90 hover:border-amber-300'
                        : entry.isToday
                        ? 'bg-indigo-50/85 border-indigo-200/80 hover:border-indigo-300'
                        : 'bg-slate-200/75 border-slate-300/80 hover:border-slate-400/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Calendar
                        className={`w-3.5 h-3.5 ${
                          isDropActive
                            ? 'text-sky-700'
                            : entry.isWeekend
                            ? 'text-amber-700'
                            : entry.isToday
                            ? 'text-indigo-600'
                            : 'text-slate-600'
                        }`}
                      />
                      <span
                        className={`text-xs font-mono font-bold tracking-wide ${
                          isDropActive
                            ? 'text-sky-900'
                            : entry.isWeekend
                            ? 'text-amber-900'
                            : entry.isToday
                            ? 'text-indigo-900'
                            : 'text-slate-700'
                        }`}
                      >
                        {entry.dateKey}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                          entry.isWeekend
                            ? 'bg-amber-200/75 text-amber-900'
                            : entry.isToday
                            ? 'bg-indigo-200/60 text-indigo-800'
                            : 'bg-slate-300/70 text-slate-700'
                        }`}
                      >
                        {entry.weekdayShort}
                      </span>
                      <span
                        className={`text-xs ${
                          entry.isWeekend
                            ? 'text-amber-700/80'
                            : entry.isToday
                            ? 'text-indigo-700/80 font-medium'
                            : 'text-slate-500'
                        }`}
                      >
                        {entry.subLabel}
                      </span>
                    </div>
                  </div>
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

              // Color coding purely via card background & border (no text badges!)
              let containerClasses =
                'bg-white border-slate-200/90 shadow-sm hover:border-slate-300';

              if (isDropTarget) {
                containerClasses =
                  'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-md';
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
                  onDragStart={(e) => onDragStartTask(e, task.id)}
                  onDragEnd={onDragEndTask}
                  onDragOver={(e) => {
                    e.preventDefault();
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
                    setActiveDropTargetKey(null);
                    setDraggedTaskId(null);
                    if (sourceId && sourceId !== task.id) {
                      handleAddPredecessor(sourceId, task.id);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTaskId((prev) =>
                      prev === task.id ? null : task.id
                    );
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                      title="Ziehen auf Task (= Vorgänger setzen), auf Datum oder Wiedervorlage rechts"
                      className="text-slate-400 group-hover:text-slate-600 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="w-4 h-4" />
                    </div>

                    {/* Active Toggle icon for tasks without predecessors */}
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

                    {/* Task ID (Year without century + integer, e.g. 26-125) */}
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

                    {/* In-Place Editable Task Title */}
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

                  {/* Right section: Predecessor chips & In-Place Editable Configured Date */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Predecessors indicator */}
                    {task.predecessorIds.length > 0 && (
                      <div className="flex items-center gap-1">
                        {task.predecessorIds.map((predId) => (
                          <span
                            key={predId}
                            title={`Vorgänger ${predId} (Rechtsklick zum Lösen)`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-amber-50 text-amber-800 border border-amber-200"
                          >
                            <CornerDownRight className="w-3 h-3 text-amber-600" />
                            {predId}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* In-Place Editable Configured Start Date (ISO-8601, no "Konf:" prefix) */}
                    <div
                      className="flex items-center text-[11px] font-mono"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isEditingDate ? (
                        <input
                          ref={inlineDateInputRef}
                          type="date"
                          value={toDateKey(new Date(task.configuredStart))}
                          onChange={async (e) => {
                            const val = e.target.value;
                            if (val) {
                              setEditingDateTaskId(null);
                              await handleSetConfiguredDate(
                                task.id,
                                dateKeyToIsoStart(val),
                                val
                              );
                            }
                          }}
                          onBlur={() => setEditingDateTaskId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape' || e.key === 'Enter') {
                              e.preventDefault();
                              setEditingDateTaskId(null);
                            }
                          }}
                          className="px-1.5 py-0.5 rounded border border-sky-500 bg-white text-slate-900 text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startInlineDateEdit(task);
                          }}
                          title="Klicken zum Bearbeiten des Startdatums"
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
        </main>

        {/* Right Sidebar: Wiedervorlage Drag Targets & Erledigt Dropzone */}
        <aside className="w-72 border-l border-slate-200 bg-white/80 p-4 flex flex-col justify-between shrink-0">
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">
                Wiedervorlage Drag-Targets
              </h2>
              <p className="text-[11px] text-slate-500 px-1 mt-0.5">
                Task auf ein Ziel ziehen, um das konfigurierte Startdatum zu
                setzen:
              </p>
            </div>

            <div className="space-y-2">
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
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isOver
                        ? 'bg-sky-50 border-sky-400 shadow-sm scale-[1.02]'
                        : 'bg-slate-50/80 border-slate-200 hover:border-slate-300 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-white border border-slate-200 shadow-sm">
                        {target.icon}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">
                          {target.label}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {target.sublabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Erledigt Drop-Target */}
            <div className="pt-2 border-t border-slate-200">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (activeDropTargetKey !== 'complete-dropzone') {
                    setActiveDropTargetKey('complete-dropzone');
                  }
                }}
                onDragLeave={() => {
                  if (activeDropTargetKey === 'complete-dropzone') {
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
                className={`p-4 rounded-xl border-2 border-dashed transition-all flex items-center gap-3 ${
                  activeDropTargetKey === 'complete-dropzone'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-sm scale-[1.02]'
                    : 'bg-slate-50/70 border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-800'
                }`}
              >
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">Erledigt</div>
                  <div className="text-[11px] text-slate-500">
                    Task hierher ziehen, um ihn abzuschließen
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 space-y-1">
            <div className="font-semibold text-slate-700 flex items-center justify-between">
              <span>Tastenkürzel</span>
              <span className="font-mono text-[10px] text-sky-600">
                ? für Hilfe
              </span>
            </div>
            <div>
              &bull; <strong className="text-slate-700">Rechtsklick</strong>:
              Kontextmenü
            </div>
            <div>
              &bull; <strong className="text-slate-700">Space / A</strong>:
              Aktivieren / Deaktivieren
            </div>
            <div>
              &bull;{' '}
              <strong className="text-slate-700">F2 / Doppelklick</strong>:
              Titel ändern
            </div>
            <div>
              &bull; <strong className="text-slate-700">Ctrl+Z / Ctrl+Y</strong>
              : Undo / Redo
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

      {/* Completed Tasks Drawer */}
      <AnimatePresence>
        {showCompletedDrawer && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 right-80 z-40 w-96 max-h-80 bg-white border border-slate-200 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Erledigte Tasks ({state.completedTasks.length})
              </span>
              <button
                onClick={() => setShowCompletedDrawer(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 overflow-y-auto space-y-1.5">
              {state.completedTasks.length === 0 ? (
                <div className="text-xs text-slate-400 py-4 text-center">
                  Noch keine erledigten Tasks.
                </div>
              ) : (
                state.completedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                  >
                    <div className="truncate pr-2">
                      <span className="font-mono text-slate-500 mr-2">
                        {t.id}
                      </span>
                      <span className="line-through text-slate-400">
                        {t.title}
                      </span>
                    </div>
                    <button
                      onClick={() => handleReopenTask(t.id)}
                      className="px-2 py-1 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 shrink-0"
                    >
                      Wieder öffnen
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
