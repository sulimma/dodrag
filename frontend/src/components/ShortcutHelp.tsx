import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
// Summarizes the active task, drag, and navigation shortcuts.
export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                Tastenkürzel &amp; Drag-and-Drop Steuerung
              </h3>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>
                  Abhängigkeit hinzufügen (Vorgänger → abhängiger Task)
                </span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Abhängigen Task auf seinen Vorgänger ziehen (A auf B: B → A)
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Shift: an der gezogenen Aufgabe gespeicherte Kanten Richtung Ziel lösen (Vorgänger und Nachfolger, kein ganzer Pfad)</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Shift+Task-Ziehen auf anderen Task
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Markierte Abhängigkeit(en) löschen</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Klick / Strg- / Shift+Klick → Entf / Backspace
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Task aktivieren / deaktivieren (ohne Vorgänger)</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Space / A / Rechtsklick
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Task in-place umbenennen</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  F2 / E / Enter / Doppelklick
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>N: Eingabe für neuen Task fokussieren</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Enter (Eingabe): Task anlegen
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Ausgewählten Task erledigen</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Del / D
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>Undo / Redo</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>Tasks auswählen / Auswahl aufheben</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  ↑ / ↓ / Esc
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-t border-slate-100">
                <span>Ansicht zum Anfang / Ende scrollen</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Pos1 / Ende
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>Seitenweise scrollen</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Bild ↑ / Bild ↓
                </kbd>
              </div>
            </div>
            <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              Task-Kürzel gelten bei Auswahl außerhalb von Eingabefeldern und Bedienelementen. In Modals und der Mini-Ansicht gibt es keine Task-Kürzel. Escape schließt Hilfe, Kontextmenü oder Editor.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
