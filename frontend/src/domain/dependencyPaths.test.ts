import { expect, it } from 'vitest';
import { dependencyPathEdges, edgeKey, edgesWithPreview, previewPathKeys } from './dependencyPaths';
import { TaskState } from './types';
const graph = (edges: string[]) => {
  const tasks: Record<string,TaskState> = {};
  for (const id of ['A','B','C','D','X','Z']) tasks[id]={id,allPredecessorIds:[],predecessorIds:[]} as unknown as TaskState;
  for (const edge of edges) { const [from,to]=edge.split('->');tasks[to].allPredecessorIds.push(from); }
  return tasks;
};
it('removes only source-incident real edges in both directions', () => {
  const tasks=graph(['A->B','B->C','A->C','B->X']);
  expect(dependencyPathEdges(tasks,'A','C').map(edgeKey)).toEqual(['A->B','A->C']);
  expect(dependencyPathEdges(tasks,'C','A').map(edgeKey)).toEqual(['A->C','B->C']);
  expect(dependencyPathEdges(tasks,'B','C').map(edgeKey)).toEqual(['B->C']);
  expect(dependencyPathEdges(tasks,'C','B').map(edgeKey)).toEqual(['B->C']);
  expect(dependencyPathEdges(tasks,'A','A')).toEqual([]);expect(dependencyPathEdges(tasks,'A','Z')).toEqual([]);
  expect(dependencyPathEdges(tasks,'missing','A')).toEqual([]);
});
it('keeps diamond inner edges and unrelated branches, including redundant source edges only', () => {
  const tasks=graph(['A->B','A->C','B->D','C->D','A->D','A->X']);
  expect(dependencyPathEdges(tasks,'A','D').map(edgeKey)).toEqual(['A->B','A->C','A->D']);
  expect(dependencyPathEdges(tasks,'D','A').map(edgeKey)).toEqual(['A->D','B->D','C->D']);
  const preview=previewPathKeys(tasks,'A','net-task:D',true);
  expect(edgesWithPreview([{from:'B',to:'D'}],Object.values(tasks),preview).map(edgeKey)).toEqual(['B->D','A->B','A->C','A->D']);
  for (const [source,target,shift] of [[null,'net-task:D',true],['A',null,true],['A','net-task:D',false],['A','net-task:Z',true]] as const) expect(previewPathKeys(tasks,source,target,shift)).toEqual([]);
});
