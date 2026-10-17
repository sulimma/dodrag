import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ARROW_DEPTH, arrowBase, ArrowMarkers } from './arrowGeometry';
import { buildCleanEdgePath } from './NetworkPlanView';
import { buildChannelGanttPath } from './GanttView';
const numbers=(path:string)=>path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
it('places top entry stem at base and forces the final spline tangent vertical even after obstacles',()=>{
  const tip={x:100,y:240};
  for(const obstacles of [[],[{x:30,y:80,width:140,height:56,cy:108}]]) {
    const path=buildCleanEdgePath({x:60,y:0},tip,obstacles as any);
    const points=numbers(path);const [cx,cy,x,y]=points.slice(-4);
    expect({x,y}).toEqual({x:100,y:232});expect(cx).toBe(x);expect(cy).toBeLessThan(y);
    expect(y+ARROW_DEPTH).toBe(tip.y);
  }
});
it('enters left and right borders orthogonally with correctly signed last rounding',()=>{
  for(const direction of [1,-1]) for(const endY of [60,-60]) {
    const tip={x:direction===1?140:50,y:endY};
    const path=buildChannelGanttPath(50,0,90,tip.x,tip.y,direction);
    const points=numbers(path);const [prevX,prevY,x,y]=points.slice(-4);
    expect({x,y}).toEqual(arrowBase(tip,{x:direction,y:0}));expect(prevY).toBe(y);
    expect(Math.sign(x-prevX)).toBe(direction);expect(x+direction*ARROW_DEPTH).toBe(tip.x);
  }
});
it('keeps all highlight markers in fixed SVG units at the base rather than the tip',()=>{
  for(const width of [1,2.8,7,14]) {
    const svg=renderToStaticMarkup(<svg><ArrowMarkers prefix="test"/><path strokeWidth={width}/></svg>);
    expect(svg.match(/markerUnits="userSpaceOnUse"/g)).toHaveLength(4);
    expect(svg.match(/refX="0"/g)).toHaveLength(4);
    expect(svg.match(/markerWidth="10"/g)).toHaveLength(4);
  }
});
