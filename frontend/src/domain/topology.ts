import { t } from '../i18n';
interface Node { id: string; creationOrder: number; predecessorIds: readonly string[] }
// Stable Kahn sort with a heap: predecessors first, then newest creationOrder and ID.
export function stableTopology<T extends Node>(nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const degree = new Map<string, number>(), successors = new Map<string, string[]>();
  for (const node of nodes) { degree.set(node.id, 0); successors.set(node.id, []); }
  for (const node of nodes) for (const pred of node.predecessorIds) if (byId.has(pred)) { degree.set(node.id, degree.get(node.id)! + 1); successors.get(pred)!.push(node.id); }
  const heap: T[] = [];
  const before = (a: T, b: T) => a.creationOrder > b.creationOrder || a.creationOrder === b.creationOrder && a.id < b.id;
  const push = (node: T) => { heap.push(node); let i = heap.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (!before(heap[i],heap[parent])) break; [heap[i],heap[parent]]=[heap[parent],heap[i]]; i=parent; } };
  for (const node of nodes) if (!degree.get(node.id)) push(node);
  const result: T[] = [];
  while (heap.length) {
    const node = heap[0], last = heap.pop()!;
    if (heap.length) { heap[0]=last; let i=0; for (;;) { let child=i*2+1; if (child>=heap.length) break; if (child+1<heap.length && before(heap[child+1],heap[child])) child++; if (!before(heap[child],heap[i])) break; [heap[i],heap[child]]=[heap[child],heap[i]]; i=child; } }
    result.push(node);
    for (const next of successors.get(node.id)!) { degree.set(next,degree.get(next)!-1); if (!degree.get(next)) push(byId.get(next)!); }
  }
  if (result.length !== nodes.length) throw new Error(t('Dependency cycle'));
  return result;
}
