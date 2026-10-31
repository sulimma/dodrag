import React, { useEffect, useRef, useState } from 'react';
import { Minimize2, Square, Copy, X } from 'lucide-react';
import { eventBridge, type WindowMode } from '../bridge/eventBridge';
import appIcon from '../assets/app-icon.png';
import { t } from '../i18n';

// Wails supplies the native resize frame; only this client strip acts as a drag surface.
export function AppTitleBar({ onWindowMode, onError }: { onWindowMode: (mode: WindowMode) => void; onError: (error: unknown) => void }) {
  const [maximized, setMaximized] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let active = true, version = 0;
    const unsubscribe = eventBridge.onWindowMaximizedChanged(value => { version++; setMaximized(value); });
    void eventBridge.getWindowMaximized().then(value => { if (active && version === 0) setMaximized(value); })
      .catch(error => { if (active) onErrorRef.current(error); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const run = (action: () => Promise<void>) => { void action().catch(onErrorRef.current); };
  const buttonClass = "h-8 w-10 inline-flex items-center justify-center hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-500";
  const restoreLabel = maximized ? t('Fenster wiederherstellen') : t('Maximieren');
  return <div data-app-title-bar style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    onDoubleClick={event => {
      if ((event.target as Element).closest('button')) return;
      event.preventDefault(); run(() => eventBridge.toggleWindowMaximized());
    }}
    onContextMenu={event => {
      if ((event.target as Element).closest('button')) return;
      event.preventDefault(); run(() => eventBridge.showWindowSystemMenu());
    }} className="h-8 flex items-center px-2 bg-slate-100 border-b border-slate-200 shrink-0">
    <img src={appIcon} alt="" draggable={false} className="w-4 h-4 mr-2" />
    <span className="text-xs font-semibold flex-1">DoDrag</span>
    <div className="flex items-center" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
      <button className={buttonClass} type="button" aria-label={t('In die Taskleiste minimieren')} title={t('In die Taskleiste minimieren')} onClick={() => onWindowMode('taskbar')}><span aria-hidden="true" className="text-base font-mono leading-none">_</span></button>
      <button className={buttonClass} type="button" aria-label={t('Kompaktansicht')} title={t('Kompaktansicht')} onClick={() => onWindowMode('mini')}><Minimize2 className="w-4 h-4 m-1" /></button>
      <button className={buttonClass} type="button" aria-label={restoreLabel} title={restoreLabel} onClick={() => run(() => eventBridge.toggleWindowMaximized())}>{maximized ? <Copy className="w-4 h-4 m-1" /> : <Square className="w-4 h-4 m-1" />}</button>
      <button className={buttonClass} type="button" aria-label={t('Schließen')} title={t('Schließen')} onClick={() => run(() => eventBridge.requestWindowClose())}><X className="w-4 h-4 m-1" /></button>
    </div>
  </div>;
}
