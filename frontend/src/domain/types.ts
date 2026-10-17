import type { EventCommand } from './eventSchema';
export type EventType = EventCommand['type'];

export interface StoredEvent {
  seq: number;
  id: string;
  timestamp: string;
  type: EventType;
  payload: Record<string, any>;
  undone: boolean;
  groupId?: string;
}

export interface TaskState {
  id: string; // e.g. "26-125"
  title: string;
  creationOrder: number; // Immutable sequence index for stable topological sorting
  createdAt: string;
  configuredStart: string; // ISO timestamp
  calculatedStart: string | null; // ISO timestamp (+1 day after latest open predecessor) or null
  effectiveStart: string; // max(configuredStart, calculatedStart)
  effectiveDateKey: string; // YYYY-MM-DD in local time
  predecessorIds: string[]; // Open predecessor IDs
  allPredecessorIds: string[]; // All configured predecessor IDs (including completed)
  successorIds: string[]; // Direct open successor IDs
  isActive: boolean; // Active flag (only effective when predecessorIds.length === 0)
  completed: boolean;
  completedAt?: string;
  isDeemphasized: boolean; // Presentation: later than first populated date, future today, or blocked.
}

export type ListEntry =
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

export interface ProjectedState {
  tasks: Record<string, TaskState>;
  openTasks: TaskState[];
  completedTasks: TaskState[];
  listEntries: ListEntry[];
  canUndo: boolean;
  canRedo: boolean;
  activeEventCount: number;
  totalEventCount: number;
  nextTaskId: string;
}

export type HighlightRole =
  | 'selected'
  | 'predecessor-direct'
  | 'predecessor-transitive'
  | 'successor-direct'
  | 'successor-transitive'
  | null;
