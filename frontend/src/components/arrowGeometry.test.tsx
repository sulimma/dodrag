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
it('keeps network edges to one bounded cubic even with alternating obstacles',()=>{
  const obstacles = [
    {x:20,y:60,width:160,height:56},
    {x:-80,y:140,width:160,height:56},
    {x:20,y:220,width:160,height:56},
  ];
  for (const endX of [60,100,-100]) {
    const path = buildCleanEdgePath({x:60,y:0},{x:endX,y:340},obstacles as any);
    expect(path.match(/[A-Za-z]/g)).toEqual(['M','C']);
    const [x0,y0,x1,y1,x2,y2,x3,y3] = numbers(path);
    expect([x0,x2,x3]).toEqual([60,endX,endX]);
    expect(x1).toBeGreaterThanOrEqual(Math.min(60,endX)-36);
    expect(x1).toBeLessThanOrEqual(Math.max(60,endX)+36);
    expect(y0).toBeLessThan(y1);expect(y1).toBeLessThan(y2);expect(y2).toBeLessThan(y3);
  }
});
it('bows aligned and nearly aligned edges instead of drawing overlapping straight stems',()=>{
  for (const dx of [0,1,-1,20,-20]) for (const height of [100,340,680]) {
    const path=buildCleanEdgePath({x:60,y:0},{x:60+dx,y:height},[]);
    const [x0,y0,x1,y1,x2,y2,x3,y3]=numbers(path);
    expect(path.match(/[A-Za-z]/g)).toEqual(['M','C']);
    expect((x1-x0)*(y3-y0)-(y1-y0)*(x3-x0)).not.toBe(0);
    expect(x2).toBe(x3);expect(y2).toBeLessThan(y3);
    if (dx===0) expect(0.375*x0+0.375*x1+0.125*x2+0.125*x3-x0).toBe(13.5);
  }
  const short=numbers(buildCleanEdgePath({x:60,y:0},{x:60,y:340},[]));
  const long=numbers(buildCleanEdgePath({x:60,y:0},{x:60,y:680},[]));
  // Different lengths leave their shared source with different tangents.
  expect((short[2]-short[0])/(short[3]-short[1])).not.toBe((long[2]-long[0])/(long[3]-long[1]));
});
it('softly adjusts curvature for a nearby obstacle without adding a detour',()=>{
  const start={x:0,y:0};const tip={x:1000,y:1000};
  const direct=buildCleanEdgePath(start,tip,[]);
  const adjusted=buildCleanEdgePath(start,tip,[{x:140,y:260,width:32,height:32}] as any);
  expect(adjusted).not.toBe(direct);
  expect(adjusted.match(/[A-Za-z]/g)).toEqual(['M','C']);
  expect(buildCleanEdgePath(start,tip,[{x:2000,y:260,width:32,height:32}] as any)).toBe(direct);
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
