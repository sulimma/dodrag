// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TimeMarkerDefaults } from './TimeMarkerDefaults';
import { setLanguage } from '../i18n';
it('adds, edits and deletes default markers in place and reports invalid input without saving it', async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); setLanguage('de');
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 const save = vi.fn(), error = vi.fn();
 function Harness() {
   const [minutes, setMinutes] = useState<number[]>([]);
   return <TimeMarkerDefaults minutes={minutes} onError={error} onSave={async values => { save(values); setMinutes(values); }} />;
 }
 const input = () => host.querySelector<HTMLInputElement>('input')!;
 const type = (value: string) => act(() => {
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
   input().dispatchEvent(new Event('input', { bubbles: true }));
 });
 try {
   await act(async () => root.render(<Harness />));
   await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Uhrzeitmarker hinzufügen"]')!.click());
   expect(save).toHaveBeenLastCalledWith([720]);
   act(() => input().focus()); type('06:30'); await act(async () => input().blur());
   expect(save).toHaveBeenLastCalledWith([390]); expect(input().value).toBe('06:30');
   const calls = save.mock.calls.length;
   act(() => input().focus()); type('25:00'); await act(async () => input().blur());
   expect(error).toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(calls); expect(input().value).toBe('06:30');
   await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Uhrzeitmarker löschen"]')!.click());
   expect(save).toHaveBeenLastCalledWith([]); expect(input()).toBeNull();
 } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
