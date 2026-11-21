import React from 'react';
import type { TaskState } from '../domain/types';

// Each missing endpoint gets its own short directed segment at the visible node.
export function FilteredEdgeStubs({ nodes, visible, vertical, marker }: {
  nodes: { task: TaskState; x: number; y: number; width: number; height: number }[];
  visible: ReadonlySet<string>; vertical?: boolean; marker: string;
}) {
  return <g stroke="#94a3b8" strokeWidth={1.5} fill="none" pointerEvents="none">
    {nodes.flatMap(({ task, x, y, width, height }) => [false, true].flatMap(outgoing => {
      const missing = (outgoing ? task.successorIds : task.predecessorIds).filter(id => !visible.has(id));
      return missing.map((id, index) => {
        const fraction = (index + 1) / (missing.length + 1);
        const ax = x + (vertical ? width * fraction : outgoing ? width : 0);
        const ay = y + (vertical ? outgoing ? height : 0 : height * fraction);
        const length = outgoing ? 14 : -14;
        const bx = ax + (vertical ? 0 : length), by = ay + (vertical ? length : 0);
        return <line key={[task.id, id, outgoing].join(':')} x1={outgoing ? ax : bx} y1={outgoing ? ay : by}
          x2={outgoing ? bx : ax} y2={outgoing ? by : ay} markerEnd={'url(#' + marker + '-default)'}><title>{id}</title></line>;
      });
    }))}
  </g>;
}
