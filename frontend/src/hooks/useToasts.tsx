import { useState } from 'react';
export interface ToastNotification {
  id: string;
  message: string;
  tone?: 'info' | 'warning' | 'success';
}
export type PushToast = (
  message: string,
  tone?: ToastNotification['tone']
) => void;
export function useToasts() {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const pushToast = (
    message: string,
    tone: 'info' | 'warning' | 'success' = 'info'
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  };
  return { toasts, pushToast };
}
