import React, { useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  limits: () => [number, number];
  onChange: (value: number) => void;
  direction?: 1 | -1;
}

export function ResizeHandle({ orientation, label, value, limits, onChange, direction = 1 }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ pointerId: number; coordinate: number; value: number } | null>(null);
  const latest = useRef({ limits, onChange });
  latest.current = { limits, onChange };
  const vertical = orientation === 'vertical';
  const resize = (next: number) => {
    const [minimum, maximum] = latest.current.limits();
    latest.current.onChange(Math.round(Math.max(minimum, Math.min(maximum, next))));
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const start = gesture.current;
      if (!start || event.pointerId !== start.pointerId) return;
      event.preventDefault();
      resize(start.value + direction * ((vertical ? event.clientX : event.clientY) - start.coordinate));
    };
    const finish = () => { gesture.current = null; setDragging(false); };
    const cancel = () => { if (gesture.current) latest.current.onChange(gesture.current.value); finish(); };
    const finishPointer = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointerId) finish(); };
    const cancelPointer = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointerId) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', cancelPointer); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelection;
    };
  }, [dragging, direction, vertical]);
  const [minimum, maximum] = limits();
  return <div role="separator" tabIndex={0} aria-orientation={orientation} aria-label={label}
    aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(Math.max(minimum, Math.min(maximum, value)))}
    data-task-selectable-text="true" data-resize-handle={orientation}
    data-resize-dragging={dragging || undefined}
    style={dragging && vertical ? { background: '#7dd3fc' } : undefined}
    className={vertical ? 'absolute right-0 top-12 bottom-0 w-1.5 z-10 cursor-col-resize hover:bg-sky-300/70 focus-visible:bg-sky-300 outline-none touch-none'
      : 'h-1.5 shrink-0 cursor-row-resize bg-slate-200 hover:bg-sky-300 focus-visible:bg-sky-300 outline-none touch-none'}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      gesture.current = { pointerId: event.pointerId, coordinate: vertical ? event.clientX : event.clientY, value };
      setDragging(true);
    }}
    onKeyDown={event => {
      const lower = vertical ? 'ArrowLeft' : 'ArrowUp';
      const higher = vertical ? 'ArrowRight' : 'ArrowDown';
      if (![lower, higher, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      resize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : value + direction * (event.key === higher ? 1 : -1) * (event.shiftKey ? 40 : 10));
    }} />;
}
