import React from 'react';
export interface Point { x:number; y:number }
export const ARROW_DEPTH = 8;
export function arrowBase(tip:Point,direction:Point):Point {
  return {x:tip.x-direction.x*ARROW_DEPTH,y:tip.y-direction.y*ARROW_DEPTH};
}
// Path ends at local (0,5), the triangle's base center; tip is exactly 8px ahead.
export function ArrowMarkers({prefix}:{prefix:string}) {
  return <defs>{[['default','#94a3b8'],['pred','#d97706'],['succ','#9333ea'],['selected','#e11d48']].map(([name,color])=><marker key={name} id={`${prefix}-${name}`} viewBox="0 0 10 10" refX="0" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto" overflow="visible"><path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={color}/></marker>)}</defs>;
}
