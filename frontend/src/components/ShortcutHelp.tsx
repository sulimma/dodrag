import React from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
// Summarizes the active task, drag, and navigation shortcuts.
export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // ponytail: No presence/opacity/scale animation: avoid WebView2 layer flicker and delayed removal.
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {t('Tastenkürzel & Drag-and-Drop Steuerung')}
              </h3>
              <button
                onClick={onClose}
                aria-label={t('Schließen')}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>
                  {t('Abhängigkeit hinzufügen (Vorgänger → abhängiger Task)')}
                </span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Abhängigen Task auf seinen Vorgänger ziehen (A auf B: B → A)')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Alt: an der gezogenen Aufgabe gespeicherte Kanten Richtung Ziel lösen (Vorgänger und Nachfolger, kein ganzer Pfad)')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Alt+Task-Ziehen auf anderen Task')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Markierte Abhängigkeit(en) löschen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Klick / Strg- / Shift+Klick → Entf / Backspace')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Task aktivieren / deaktivieren')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Space / A / Rechtsklick')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Task in-place umbenennen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('F2 / E / Enter / Doppelklick')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('N: Eingabe für neuen Task fokussieren')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Enter (Eingabe): Task anlegen')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Ausgewählten Task erledigen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Del / D
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Erneut öffnen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  O
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Startdatum auf Heute setzen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  T
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Kompaktansicht / Hauptansicht wiederherstellen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Ctrl+M
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Undo / Redo')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>{t('Tasks auswählen / Auswahl aufheben')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  ↑ / ↓ / Esc
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-t border-slate-100">
                <span>{t('Ansicht zum Anfang / Ende scrollen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Pos1 / Ende')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>{t('Seitenweise scrollen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Bild ↑ / Bild ↓')}
                </kbd>
              </div>
            </div>
            <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              {t('Tastenkürzel gelten im aktiven Fenster, auch in der Mini-Ansicht und bei fokussierten Buttons. In Texteingaben bleiben Buchstaben Texteingaben. Einstellungen und Hilfe sperren App-Aktionen. Escape schließt Hilfe, Kontextmenü oder Editor.')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
