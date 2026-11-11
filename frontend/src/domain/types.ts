import type { TimelineState, TimeMarker } from './timeMarkers';
import type { TaskTiming } from './duration';
import type { EventCommand } from './eventSchema';
export type EventType = EventCommand['type'];

export type StoredEvent = EventCommand & {
  seq: number;
  id: string;
  timestamp: string;
  undone: boolean;
  groupId?: string;
};

export interface TaskLogEntry {
  id: string;
  text: string;
  createdAt: string;
  lifecycle?: 'created' | 'completed' | 'reopened';
  copiedFromId?: string;
}

export interface ChecklistProgress {
  checked: number;
  total: number;
}

export interface TaskState extends TaskTiming {
  id: string; // e.g. "26-125"
  title: string;
  description: string;
  logEntries: TaskLogEntry[];
  checklistProgress: ChecklistProgress | null;
  timeMarkerId?: string; // Explicit marker constraint, independent of configuredStart
  manualOrder?: number; // Database-wide user order; dates and activity never rewrite it
  sortSlot?: number; // Visible time-slot lower bound, local minutes; active tasks use 0
  creationOrder: number; // Immutable sequence index for stable topological sorting
  topologyLevel: number; // Level in the complete configured dependency graph
  createdAt: string;
  configuredStart: string; // ISO timestamp
  calculatedStart: string | null; // Now for active tasks; otherwise latest effective predecessor timestamp + remaining duration, or null
  effectiveStart: string; // Now for active tasks; otherwise max(configuredStart, calculatedStart)
  effectiveDateKey: string; // YYYY-MM-DD in local time
  predecessorIds: string[]; // Open predecessor IDs
  allPredecessorIds: string[]; // All configured predecessor IDs (including completed)
  successorIds: string[]; // Direct open successor IDs
  isActive: boolean; // Any open task can be active, regardless of predecessors
  completed: boolean;
  completedAt?: string;
  isDeemphasized: boolean; // Presentation: later than first populated date, future today, or blocked.
}

export type ListEntry =
  | { kind: 'time'; key: string; marker: TimeMarker; weekdayShort: string }
  | {
      kind: 'date';
      key: string; // e.g. "date:2026-10-16"
      dateKey: string; // "YYYY-MM-DD"
      isoDate: string; // Start of day ISO string
      label: string;
      subLabel: string;
      collapsedCount: number; // How many earlier consecutive date entries were collapsed into this one
      collapsedFromDateKey?: string;
      isToday: boolean;
      isWeekend: boolean;
      weekdayShort: string;
    }
  | {
      kind: 'task';
      key: string; // e.g. "task:26-101"
      task: TaskState;
    };

export interface TaskDayBalance { start: number; added: number; removed: number; end: number }

export interface ProjectedState {
  timeline: TimelineState;
  tasks: Record<string, TaskState>;
  openTasks: TaskState[];
  completedTasks: TaskState[];
  listEntries: ListEntry[];
  canUndo: boolean;
  canRedo: boolean;
  activeEventCount: number;
  totalEventCount: number;
  todayBalance: TaskDayBalance;
  nextTaskId: string;
}

export type HighlightRole =
  | 'selected'
  | 'predecessor-direct'
  | 'predecessor-transitive'
  | 'successor-direct'
  | 'successor-transitive'
  | null;
