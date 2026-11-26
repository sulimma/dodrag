export const timeMeasurementPluginId = 'time-measurement';

export interface TimeMeasurementSession {
  id: number;
  taskId: string;
  taskCreationEventId: string;
  startMs: number;
  endMs: number | null;
  elapsedMs: number | null;
}

export interface TimeMeasurementState {
  running: TimeMeasurementSession | null;
  interrupted: TimeMeasurementSession | null;
  sessions: TimeMeasurementSession[];
  discarded: boolean;
}
