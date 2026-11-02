// Installed before rendering, outside React lifecycles. Reporting must never
// create another unhandled rejection if the native bridge is unavailable.
export function reportError(context: string, error: unknown) {
  try {
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    const send = window.go?.main?.App?.ReportFrontendError;
    if (send) void send(`${context}\n${detail}`.slice(0, 16384)).catch(() => {});
  } catch { /* Diagnostics cannot interfere with the original error. */ }
}

export function installErrorLogging() {
  const error = (event: ErrorEvent) => reportError('window.error', event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
  const rejection = (event: PromiseRejectionEvent) => reportError('unhandledrejection', event.reason);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
  };
}
