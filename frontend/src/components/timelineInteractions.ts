import type { TimeMarker } from '../domain/timeMarkers';
export interface TimelineInteractions {
  selectedMarkerId: string | null;
  editingMarkerId: string | null;
  editingValue: string;
  select: (id: string | null) => void;
  startEdit: (marker: TimeMarker) => void;
  changeEdit: (value: string) => void;
  commitEdit: () => Promise<void>;
  cancelEdit: () => void;
  remove: (id: string) => Promise<void>;
  dropOnDate: (dateKey: string) => void;
  createAtGap: (relativeTaskId: string, side: 'before' | 'after') => void;
  bindTask: (taskId: string, markerId: string) => void;
}
