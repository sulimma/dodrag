// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskTimingInput } from './TaskTimingInput';
import { legacyTiming, type TaskTiming } from '../domain/duration';
import { setLanguage, t } from '../i18n';
let host: HTMLDivElement, root: Root, value: TaskTiming;
const save = vi.fn(), error = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); setLanguage('de');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  value = { ...legacyTiming }; save.mockReset(); error.mockReset();
  save.mockImplementation(async next => { value = next; render(); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (defaultOnly = false, key = 'a') => root.render(<TaskTimingInput key={key} defaultOnly={defaultOnly} value={value} onSave={save} onError={error} />);
const input = (key: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${t(key)}"]`)!;
const type = (key: string, text: string) => act(() => {
  const node = input(key); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
const leave = async (key: string) => act(async () => { input(key).focus(); input(key).blur(); });

it('starts blank, saves the complete tuple once when leaving the group, and accepts a decimal comma', async () => {
  act(() => render());
  expect(input('Fortschritt').value).toBe(''); expect(input('Dauer').value).toBe('1');
  act(() => input('Fortschritt').focus()); type('Fortschritt', '0,5');
  act(() => input('Dauer').focus()); expect(save).not.toHaveBeenCalled();
  type('Dauer', '2,5'); await leave('Dauer');
  expect(save).toHaveBeenCalledTimes(1);
  expect(value).toEqual({ duration: 2.5, progress: 0.5, durationUnit: 'days' });
  type('Fortschritt', ''); await leave('Fortschritt'); expect(value.progress).toBeNull();
  type('Fortschritt', '0'); await leave('Fortschritt'); expect(value.progress).toBe(0);
});
it('saves unit changes, rejects invalid values, cancels drafts and restores after a failed save', async () => {
  act(() => render());
  await act(async () => { const node = host.querySelector('select')!; node.value = 'hours'; node.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(value.durationUnit).toBe('hours');
  type('Dauer', '0'); await leave('Dauer'); expect(error).toHaveBeenCalledTimes(1); expect(input('Dauer').value).toBe('1');
  type('Fortschritt', '9'); await leave('Fortschritt'); expect(error).toHaveBeenCalledTimes(2);
  type('Dauer', '3'); act(() => { input('Dauer').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(input('Dauer').value).toBe('1');
  save.mockRejectedValueOnce(new Error('disk')); type('Dauer', '4'); await leave('Dauer');
  expect(input('Dauer').value).toBe('1'); expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'disk' }));
});
it('shows only duration and unit for defaults and resets drafts when switching tasks', async () => {
  value = { duration: 45, durationUnit: 'minutes', progress: null };
  act(() => render(true)); expect(input('Standarddauer').value).toBe('45'); expect(input('Fortschritt')).toBeNull();
  act(() => render()); type('Fortschritt', '12');
  value = { duration: 5, durationUnit: 'days', progress: null }; act(() => render(false, 'b'));
  expect(input('Dauer').value).toBe('5'); expect(input('Fortschritt').value).toBe('');
});
