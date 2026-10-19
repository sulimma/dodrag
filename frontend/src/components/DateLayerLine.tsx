import React from 'react';
import { formatDate } from '../i18n';
import { dateKeyToIsoStart } from '../domain/projector';

export interface DateLayerLineProps {
  dateKey: string;
  weekdayShort: string;
  isWeekend: boolean;
  isToday: boolean;
  isDropActive: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  className?: string;
  style?: React.CSSProperties;
  dataFlipKey?: string;
}

/**
 * Shared thin horizontal date divider used in both List View and Network Plan View (DRY).
 * Visually distinct from draggable task cards so it is immediately clear that date layers
 * are static timeline markers and drop zones rather than movable items.
 */
export const DateLayerLine: React.FC<DateLayerLineProps> = ({
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
      data-flip-key={dataFlipKey}
      style={style}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`transition-colors rounded-lg ${
        isDropActive
          ? 'bg-sky-100/60'
          : isWeekend
          ? 'bg-amber-50/35'
          : ''
      } ${className}`}
    >
      <div
        className={`w-full border-t flex items-center gap-1.5 pt-1.5 px-2 select-none ${
          isDropActive
            ? 'border-sky-400'
            : isWeekend
            ? 'border-amber-300/90'
            : isToday
            ? 'border-indigo-300/90'
            : 'border-slate-300/90'
        }`}
      >
        <span
          className={`text-[11px] font-mono font-bold ${
            isWeekend
              ? 'text-amber-900'
              : isToday
              ? 'text-indigo-900'
              : 'text-slate-600'
          }`}
        >
          {formatDate(dateKeyToIsoStart(dateKey))}
        </span>
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
      </div>
    </div>
  );
};
