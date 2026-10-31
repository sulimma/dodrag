import React from 'react';
import { Square } from 'lucide-react';
import type { WindowMode } from '../bridge/eventBridge';
import { t } from '../i18n';

// Compact mode can move to the taskbar or restore the normal window.
export function WindowModeControls({ mode, onChange }: { mode: WindowMode; onChange: (mode: WindowMode) => void }) {
  const options = [
    { mode: 'taskbar' as const, label: t('In die Taskleiste minimieren'), icon: Square },
    { mode: 'window' as const, label: t('Fenster'), icon: Square },
  ];
  return <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag', '--wails-draggable': 'no-drag' } as React.CSSProperties}>
    {options.map(({ mode: target, label, icon: Icon }) => <button key={target} type="button"
      title={label} aria-label={label} aria-pressed={mode === target} onClick={() => onChange(target)}
      className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-sky-700 hover:bg-sky-100 aria-pressed:bg-sky-100">
      {target === 'taskbar' ? <span aria-hidden="true" className="text-base font-mono leading-none">_</span> : <Icon className="w-3.5 h-3.5" />}
    </button>)}
  </div>;
}
