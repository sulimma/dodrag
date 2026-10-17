import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ToastNotification } from '../hooks/useToasts';
// Renders transient status notifications above the current view.
export function Toasts({ toasts }: { toasts: ToastNotification[] }) {
  return (
    <div className="fixed bottom-4 left-6 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className={`px-3.5 py-2 rounded-xl border text-xs font-medium shadow-md backdrop-blur-md ${
              t.tone === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : t.tone === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-white border-slate-200 text-slate-800'
            }`}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
