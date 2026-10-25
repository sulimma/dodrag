import type { TaskState } from './types';
export interface DependencyEdge { from: string; to: string }
export const edgeKey = (edge: DependencyEdge) => `${edge.from}->${edge.to}`;

// Only source-incident stored edges leading towards the target, in either direction.
export function dependencyPathEdges(tasks: Record<string, TaskState>, source: string, target: string): DependencyEdge[] {
  if (source === target || !tasks[source] || !tasks[target]) return [];
  const successors = new Map<string, string[]>();
  for (const task of Object.values(tasks)) successors.set(task.id, []);
  for (const task of Object.values(tasks)) for (const pred of task.allPredecessorIds) successors.get(pred)?.push(task.id);
  const reachable = (start: string, next: (id: string) => readonly string[]) => {
    const visited = new Set<string>(), stack = [start];
    while (stack.length) { const id = stack.pop()!; if (visited.has(id)) continue; visited.add(id); stack.push(...next(id)); }
    return visited;
  };
  const targetAncestors = reachable(target,id => tasks[id]?.allPredecessorIds ?? []);
  const edges: DependencyEdge[] = [];
  if (targetAncestors.has(source)) {
    for (const neighbor of successors.get(source) ?? []) if (targetAncestors.has(neighbor)) edges.push({from:source,to:neighbor});
  } else {
    const targetDescendants = reachable(target,id => successors.get(id) ?? []);
    if (!targetDescendants.has(source)) return [];
    for (const neighbor of tasks[source].allPredecessorIds) if (targetDescendants.has(neighbor)) edges.push({from:neighbor,to:source});
  }
  return edges.sort((a,b) => edgeKey(a).localeCompare(edgeKey(b)));
}

export function edgesWithPreview(reduced: DependencyEdge[], tasks: TaskState[], preview: readonly string[]): DependencyEdge[] {
  const edges = new Map(reduced.map(edge => [edgeKey(edge),edge]));
  const keys = new Set(preview), ids = new Set(tasks.map(task => task.id));
  for (const task of tasks) for (const pred of task.allPredecessorIds) {
    const edge = {from:pred,to:task.id};
    if (ids.has(pred) && keys.has(edgeKey(edge))) edges.set(edgeKey(edge),edge);
  }
  return [...edges.values()];
}

export function previewPathKeys(tasks: Record<string, TaskState>, source: string | null, dropKey: string | null, shift: boolean): string[] {
  const target = /^(?:task|net-task|gantt-task|gantt-list-task|detail-task):(.+)$/.exec(dropKey ?? '')?.[1];
  return shift && source && target ? dependencyPathEdges(tasks,source,target).map(edgeKey) : [];
}
