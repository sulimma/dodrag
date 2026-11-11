import React from 'react';
import { formatDate } from '../i18n';
import { dateKeyToIsoStart } from '../domain/projector';

export interface DateLayerLineProps {
  elementRef?: React.Ref<HTMLDivElement>;
  time?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  draggableKey?: string;
  editing?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  dateKey: string;
  weekdayShort: string;
  isWeekend: boolean;
  isToday: boolean;
  isDropActive: boolean;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  className?: string;
  style?: React.CSSProperties;
  dataFlipKey?: string;
}

// Shared date/time divider. Date headings are visually stronger; both variants
// use the same geometry, pointer gesture and task-drop semantics.
export const DateLayerLine: React.FC<DateLayerLineProps> = ({
  elementRef, time, trailing, selected, draggableKey, editing, onDragStart, onClick, onDoubleClick, onKeyDown,
  dateKey,
  weekdayShort,
  isWeekend,
  isToday,
  isDropActive,
  onDragOver,
  onDragLeave,
  onDrop,
  className = '',
  style,
  dataFlipKey,
}) => {
  return (
    <div
      ref={elementRef}
      data-flip-key={dataFlipKey}
      data-date-divider={time === undefined ? dateKey : undefined}
      data-time-marker={time !== undefined ? dataFlipKey : undefined}
      data-task-drag={draggableKey}
      data-task-drag-disabled={editing || undefined}
      tabIndex={time === undefined ? undefined : 0}
      onDragStart={onDragStart}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      data-task-drop-target={onDrop ? dateKey : undefined}
      style={style}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`transition-colors rounded-lg ${selected ? "ring-2 ring-sky-400 bg-sky-50" : ""} ${draggableKey ? "cursor-grab" : ""} ${
        isDropActive
          ? 'bg-sky-100/60'
          : isWeekend
          ? 'bg-amber-50/35'
          : ''
      } ${className}`}
    >
      <div
        className={`w-full ${time === undefined ? "border-t-2" : "border-t"} flex items-center gap-1.5 pt-1.5 px-2 select-none ${
          isDropActive
            ? 'border-sky-400'
            : isWeekend
            ? time === undefined ? 'border-amber-700' : 'border-amber-300/90'
            : isToday
            ? time === undefined ? 'border-indigo-700' : 'border-indigo-300/90'
            : time === undefined ? 'border-slate-600' : 'border-slate-300/90'
        }`}
      >
        {time === undefined && <span
          className={`text-[11px] font-mono font-extrabold ${
            isWeekend
              ? 'text-amber-900'
              : isToday
              ? 'text-indigo-900'
              : 'text-slate-900'
          }`}
        >
          {formatDate(dateKeyToIsoStart(dateKey))}
        </span>}
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            isWeekend
              ? 'bg-amber-200/80 text-amber-900'
              : isToday
              ? 'bg-indigo-200/60 text-indigo-800'
              : 'bg-slate-200 text-slate-700'
          }`}
        >
          {weekdayShort}
        </span>
        {time !== undefined && <span className="text-[11px] font-mono font-semibold text-slate-600">{time}</span>}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </div>
    </div>
  );
};
