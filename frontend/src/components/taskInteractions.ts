import React from 'react';
export interface TaskInteractions {
  onSelectTask: (id:string)=>void; onDragStartTask:(event:React.DragEvent,id:string)=>void; onDragEndTask:()=>void;
  onShiftKeyChange:(shift:boolean)=>void; isShiftDrag:boolean; draggedTaskId:string|null;
  setDraggedTaskId:(id:string|null)=>void; setActiveDropTargetKey:(key:string|null)=>void;
  onAddPredecessor:(source:string,target:string)=>void; onRemoveDependencyBetween:(source:string,target:string)=>void;
  onContextMenuTask:(event:React.MouseEvent,id:string)=>void;
}
export function taskInteractions(id:string,key:string,actions:TaskInteractions) {
  return {
    draggable:true,
    onMouseDown:undefined,
    onDragStart:(event:React.DragEvent)=>actions.onDragStartTask(event,id),
    onDragEnd:actions.onDragEndTask,
    onClick:(event:React.MouseEvent)=>{event.stopPropagation(); if (!(event.target as HTMLElement).closest('input,button,textarea')) actions.onSelectTask(id);},
    onContextMenu:(event:React.MouseEvent)=>actions.onContextMenuTask(event,id),
    onDragOver:(event:React.DragEvent)=>{event.preventDefault();actions.onShiftKeyChange(event.shiftKey);if(actions.draggedTaskId && actions.draggedTaskId!==id){event.dataTransfer.dropEffect='move';actions.setActiveDropTargetKey(key);}},
    onDragLeave:(event:React.DragEvent)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)) actions.setActiveDropTargetKey(null);},
    onDrop:(event:React.DragEvent)=>{event.preventDefault();const source=actions.draggedTaskId||event.dataTransfer.getData('text/plain');actions.setActiveDropTargetKey(null);actions.setDraggedTaskId(null);if(source && source!==id){if(event.shiftKey||actions.isShiftDrag) actions.onRemoveDependencyBetween(source,id);else actions.onAddPredecessor(source,id);}},
  };
}
