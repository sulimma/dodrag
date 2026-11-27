// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { menuPosition, useDesktopContextMenu } from './ContextMenuPopup';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); });

async function mount() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const chosen = vi.fn();
  let abort = new AbortController();
  function Fixture({ database }: { database: string }) {
    const { showMenu, popup } = useDesktopContextMenu(false, database);
    return <><dialog open><button onClick={event => {
      void showMenu([
        { id: 'disabled', label: 'Unavailable', disabled: true },
        { id: 'first', label: 'First', disabled: false },
        { id: 'separator', label: '', disabled: false, separator: true },
        { id: 'last', label: 'Last', disabled: false },
      ], menuPosition(event), abort.signal).then(chosen);
    }}>Open</button></dialog>{popup}</>;
  }
  await act(async () => root.render(<Fixture database="first" />));
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  const trigger = host.querySelector('button')!;
  const open = async () => { abort = new AbortController(); await act(async () => { trigger.focus(); trigger.click(); }); };
  const key = async (value: string) => act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });
  return { host, chosen, trigger, open, key, abort: async () => act(async () => abort.abort()),
    switchDatabase: async () => act(async () => root.render(<Fixture database="second" />)) };
}

it('keeps dialog menus interactive, skips disabled items and separators, wraps focus and cancels with Tab', async () => {
  const fixture = await mount(); await fixture.open();
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.closest('dialog[open]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe('First');
  await fixture.key('ArrowUp'); expect(document.activeElement?.textContent).toBe('Last');
  await fixture.key('ArrowDown'); expect(document.activeElement?.textContent).toBe('First');
  await fixture.key('End'); expect(document.activeElement?.textContent).toBe('Last');
  await fixture.key('Home'); expect(document.activeElement?.textContent).toBe('First');
  await fixture.key('Tab');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(fixture.trigger);
  expect(fixture.chosen).toHaveBeenLastCalledWith('');
});

it('cancels obsolete menu requests on abort and database replacement without running an action', async () => {
  const fixture = await mount(); await fixture.open();
  const oldAction = document.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')!;
  await fixture.abort();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => oldAction.click());
  expect(fixture.chosen).toHaveBeenCalledTimes(1);
  expect(fixture.chosen).toHaveBeenLastCalledWith('');
  await fixture.open(); await fixture.switchDatabase();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(fixture.chosen).toHaveBeenCalledTimes(2);
  expect(fixture.chosen).toHaveBeenLastCalledWith('');
});

it('dismisses outside clicks and window blur, returning focus without selecting an action', async () => {
  const fixture = await mount(); await fixture.open();
  await act(async () => (document.querySelector('[role="menu"]')!.parentElement as HTMLElement).click());
  expect(document.activeElement).toBe(fixture.trigger);
  expect(fixture.chosen).toHaveBeenLastCalledWith('');
  await fixture.open(); await act(async () => window.dispatchEvent(new Event('blur')));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(fixture.chosen).toHaveBeenCalledTimes(2);
});
