// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { eventBridge, type AppSettings } from '../bridge/eventBridge';
import { t } from '../i18n';

const settings: AppSettings = {
  version: '0.5.0rc', buildTime: '2026-11-06T09:00:00Z',
  activeDatabasePath: 'active.db', databaseReady: true, autostart: false,
  knownDatabases: [
    { name: 'Active', path: 'active.db', exists: true, isDemo: false },
    { name: 'Newer', path: 'newer.db', exists: true, isDemo: false, requiresUpdate: true },
  ],
};
let element: HTMLDivElement, root: Root;
let browser: MockInstance<typeof eventBridge.openExternalURL>;
let close: MockInstance<typeof eventBridge.requestWindowClose>;
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
  browser = vi.spyOn(eventBridge, 'openExternalURL').mockResolvedValue(undefined);
  close = vi.spyOn(eventBridge, 'requestWindowClose').mockResolvedValue(undefined);
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function render(value = settings) {
  act(() => root.render(<SettingsModal settings={value} onClose={vi.fn()}
    onSelectFolder={async () => ''} onCreateDatabase={async () => {}}
    onOpenExistingDatabase={async () => {}} onSwitchDatabase={async () => {}}
    onDeleteDatabase={async () => {}} onToggleAutostart={async () => {}} />));
}
const updateLink = () => [...element.querySelectorAll('a')].find(link => link.textContent === t('Update'));
const clickUpdate = () => act(() => updateLink()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

it('offers releases for an incompatible inactive database without an online update request', () => {
  render();
  expect(updateLink()?.getAttribute('href')).toBe('https://github.com/sulimma/dodrag/releases');
  expect(browser).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  render({ ...settings, knownDatabases: settings.knownDatabases.map(database => ({ ...database, requiresUpdate: false })) });
  expect(updateLink()).toBeUndefined();
  expect(browser).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
});

it('opens releases before requesting regular app close and blocks duplicate clicks while pending', async () => {
  let opened!: () => void;
  browser.mockImplementationOnce(() => new Promise<void>(resolve => { opened = resolve; }));
  render();
  clickUpdate(); clickUpdate();
  expect(browser).toHaveBeenCalledOnce();
  expect(browser).toHaveBeenCalledWith('https://github.com/sulimma/dodrag/releases');
  expect(close).not.toHaveBeenCalled();
  await act(async () => opened());
  expect(close).toHaveBeenCalledOnce();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('keeps the app open if opening the browser fails and allows retry', async () => {
  browser.mockRejectedValueOnce(new Error('Browser failed'));
  render();
  await act(async () => clickUpdate());
  expect(close).not.toHaveBeenCalled(); expect(element.textContent).toContain('Browser failed');
  await act(async () => clickUpdate());
  expect(browser).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
  expect(element.textContent).not.toContain('Browser failed');
});

it('reports a failed native close request and leaves the update action available', async () => {
  close.mockRejectedValueOnce(new Error('Close failed'));
  render({ ...settings, databaseReady: false });
  await act(async () => clickUpdate());
  expect(browser).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(element.textContent).toContain('Close failed');
  expect(updateLink()?.getAttribute('aria-disabled')).toBe('false');
});
