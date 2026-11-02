// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installErrorLogging, reportError } from './diagnostics';

afterEach(() => { delete window.go; });

it('persists uncaught errors with stack and unhandled promise reasons', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  window.go = { main: { App: { ReportFrontendError: send } as any } };
  const remove = installErrorLogging();
  try {
    const failure = new Error('drop failed');
    window.dispatchEvent(new ErrorEvent('error', { error: failure }));
    const rejected = new Event('unhandledrejection');
    Object.defineProperty(rejected, 'reason', { value: 'save failed' });
    window.dispatchEvent(rejected);
    expect(send).toHaveBeenCalledWith(expect.stringContaining(failure.stack!));
    expect(send).toHaveBeenCalledWith(expect.stringContaining('save failed'));
  } finally { remove(); }
  send.mockClear();
  window.dispatchEvent(new ErrorEvent('error', { message: 'after cleanup' }));
  expect(send).not.toHaveBeenCalled();
});

it('bounds reports and tolerates missing, throwing and rejected bridges', async () => {
  expect(() => reportError('test', 'missing bridge')).not.toThrow();
  const send = vi.fn().mockRejectedValue(new Error('disk full'));
  window.go = { main: { App: { ReportFrontendError: send } as any } };
  reportError('test', 'x'.repeat(20000));
  expect(send.mock.calls[0][0].length).toBeLessThanOrEqual(16384);
  await Promise.resolve();
  send.mockImplementation(() => { throw new Error('bridge failed'); });
  expect(() => reportError('test', 'failure')).not.toThrow();
});
