import type { StoredEvent, TaskState, TaskLogEntry } from './types';
import { durationDays, progressRatio } from './duration';

export function newTaskMemberships(taskId: string, projectIds: readonly string[]) {
  return projectIds.map(projectId => ({ type: 'PROJECT_MEMBER_SET' as const, payload: { taskId, projectId, assigned: true } }));
}

export interface Project {
  projectId: string;
  code: string;
  color: string;
  summary: string;
  description: string;
}

export function projectCatalog(events: readonly StoredEvent[]) {
  const projects = new Map<string, Project>();
  const logs = new Map<string, TaskLogEntry[]>();
  const members = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.undone) continue;
    if (event.type === 'PROJECT_SAVED') projects.set(event.payload.projectId, event.payload);
    if (event.type === 'PROJECT_NOTE_SET') {
      const { projectId, entryId, text } = event.payload;
      const entries = logs.get(projectId) ?? [];
      const index = entries.findIndex(entry => entry.id === entryId);
      if (!text && index >= 0) entries.splice(index, 1);
      else if (text && index >= 0) entries[index].text = text;
      else if (text) entries.push({ id: entryId, text, createdAt: event.timestamp });
      logs.set(projectId, entries);
    }
    if (event.type === 'PROJECT_MEMBER_SET') {
      const { projectId, taskId, assigned } = event.payload;
      const ids = members.get(taskId) ?? new Set<string>();
      if (assigned) ids.add(projectId);
      else ids.delete(projectId);
      members.set(taskId, ids);
    }
  }
  return { projects, members, logs };
}

type ProgressTask = Pick<TaskState, 'duration' | 'durationUnit' | 'progress' | 'checklistProgress' | 'completed'>;

export function projectProgress(tasks: readonly ProgressTask[]) {
  let days = 0;
  let done = 0;
  for (const task of tasks) {
    const duration = durationDays(task);
    days += duration;
    done += duration * (task.completed ? 1 : progressRatio(task) ?? 0);
  }
  return { days, done };
}
