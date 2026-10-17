import { EventCommand, parseCommand } from './eventSchema';
import { StoredEvent } from './types';

interface MutableTask { title: string; configuredStart: string; completed: boolean; isActive: boolean; predecessors: Set<string> }
export function replayCommands(events: StoredEvent[]) {
  const tasks = new Map<string, MutableTask>();
  for (const event of events) {
    if (event.undone) continue;
    const command = parseCommand(event);
    applyCommand(tasks, command);
  }
  return tasks;
}
export function applyCommand(tasks: Map<string, MutableTask>, command: EventCommand): boolean {
  const p = command.payload;
  const task = tasks.get(p.taskId);
  if (command.type === 'TASK_CREATED') {
    if (task) throw new Error(`Duplicate task ID: ${p.taskId}`);
    tasks.set(p.taskId, { title: command.payload.title, configuredStart: command.payload.configuredStart, completed: false, isActive: false, predecessors: new Set() });
    return true;
  }
  if (!task) throw new Error(`Unknown task: ${p.taskId}`);
  switch (command.type) {
    case 'TASK_RENAMED': if (task.title === command.payload.title) return false; task.title = command.payload.title; break;
    case 'TASK_START_DATE_SET': if (Date.parse(task.configuredStart) === Date.parse(command.payload.configuredStart)) return false; task.configuredStart = command.payload.configuredStart; break;
    case 'TASK_ACTIVE_SET':
      if (task.isActive === command.payload.isActive) return false;
      if (command.payload.isActive && (task.completed || [...task.predecessors].some(id => !tasks.get(id)?.completed))) throw new Error('Task has open predecessors or is completed');
      task.isActive = command.payload.isActive; break;
    case 'TASK_COMPLETED': if (task.completed) return false; task.completed = true; task.isActive = false; break;
    case 'TASK_REOPENED': if (!task.completed) return false; task.completed = false; break;
    case 'DEPENDENCY_ADDED': {
      const pred = command.payload.predecessorId;
      if (!tasks.has(pred)) throw new Error(`Unknown predecessor: ${pred}`);
      if (task.predecessors.has(pred)) return false;
      const stack = [pred], visited = new Set<string>();
      while (stack.length) {
        const current = stack.pop()!;
        if (current === p.taskId) throw new Error('Dependency cycle');
        if (visited.has(current)) continue;
        visited.add(current); stack.push(...tasks.get(current)!.predecessors);
      }
      task.predecessors.add(pred); break;
    }
    case 'DEPENDENCY_REMOVED':
      if (!tasks.has(command.payload.predecessorId)) throw new Error('Unknown predecessor');
      return task.predecessors.delete(command.payload.predecessorId);
  }
  return true;
}
