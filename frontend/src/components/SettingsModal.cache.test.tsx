// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { eventBridge, type AppSettings } from '../bridge/eventBridge';
import { t } from '../i18n';

let element: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let unmounted: boolean;
let close: ReturnType<typeof vi.fn>;
const settings: AppSettings = {
  knownDatabases: [], activeDatabasePath: 'tasks.db', databaseReady: true, autostart: false,
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(eventBridge, 'clearPreviewCache').mockResolvedValue(undefined);
  vi.spyOn(eventBridge, 'openPreviewCacheInExplorer').mockResolvedValue(undefined);
  vi.spyOn(eventBridge, 'showTaskContextMenu').mockResolvedValue('');
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
  unmounted = false;
  close = vi.fn();
  act(() => root.render(<SettingsModal settings={settings} onClose={close}
    onSelectFolder={async () => ''} onCreateDatabase={async () => {}}
    onOpenExistingDatabase={async () => {}} onSwitchDatabase={async () => {}}
    onDeleteDatabase={async () => {}} onToggleAutostart={async () => {}} />));
});

afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  element.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const clearButton = () => [...element.querySelectorAll('button')].find(button => button.textContent === t('Cache löschen'))!;
const openMenu = async () => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => { clearButton().dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
};

it('clears via bridge, blocks duplicate actions while pending and announces success only after completion', async () => {
  let finish!: () => void;
  vi.mocked(eventBridge.clearPreviewCache).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { clearButton().click(); });
  expect(eventBridge.clearPreviewCache).toHaveBeenCalledTimes(1);
  expect(clearButton().disabled).toBe(true);
  expect(element.querySelector('[role="status"]')).toBeNull();
  await act(async () => { clearButton().click(); });
  expect(eventBridge.clearPreviewCache).toHaveBeenCalledTimes(1);
  vi.mocked(eventBridge.showTaskContextMenu).mockResolvedValueOnce('open-cache-explorer');
  await openMenu();
  expect(eventBridge.showTaskContextMenu).toHaveBeenLastCalledWith([{
    id: 'open-cache-explorer', label: t('Cache-Ordner im File-Explorer öffnen'), disabled: true,
  }]);
  expect(eventBridge.openPreviewCacheInExplorer).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(clearButton().disabled).toBe(false);
  expect(element.querySelector('[role="status"]')?.textContent).toBe(t('Vorschau-Cache wurde gelöscht.'));
  expect(close).not.toHaveBeenCalled();
});

it('uses a native popup for Explorer without rendering an HTML menu or clearing on right click', async () => {
  vi.mocked(eventBridge.showTaskContextMenu).mockResolvedValueOnce('open-cache-explorer');
  await openMenu();
  expect(eventBridge.showTaskContextMenu).toHaveBeenLastCalledWith([{
    id: 'open-cache-explorer', label: t('Cache-Ordner im File-Explorer öffnen'), disabled: false,
  }]);
  expect(eventBridge.openPreviewCacheInExplorer).toHaveBeenCalledTimes(1);
  expect(eventBridge.clearPreviewCache).not.toHaveBeenCalled();
  expect(element.textContent).not.toContain(t('Cache-Ordner im File-Explorer öffnen'));
  expect(element.querySelector('[role="menu"]')).toBeNull();
  await openMenu();
  vi.mocked(eventBridge.showTaskContextMenu).mockResolvedValueOnce('unknown');
  await openMenu();
  expect(eventBridge.openPreviewCacheInExplorer).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

it('shows failures instead of success and allows retry', async () => {
  vi.mocked(eventBridge.clearPreviewCache).mockRejectedValueOnce(new Error('locked file'));
  await act(async () => { clearButton().click(); });
  expect(element.textContent).toContain(t('Vorschau-Cache konnte nicht gelöscht werden.'));
  expect(element.textContent).toContain('locked file');
  expect(element.querySelector('[role="status"]')).toBeNull();
  expect(clearButton().disabled).toBe(false);
  await act(async () => { clearButton().click(); });
  expect(element.textContent).not.toContain('locked file');
  expect(element.querySelector('[role="status"]')).not.toBeNull();
  vi.mocked(eventBridge.openPreviewCacheInExplorer).mockRejectedValueOnce(new Error('explorer failed'));
  vi.mocked(eventBridge.showTaskContextMenu).mockResolvedValueOnce('open-cache-explorer');
  await openMenu();
  expect(element.textContent).toContain(t('Ordner konnte nicht geöffnet werden.'));
  expect(element.textContent).toContain('explorer failed');
  expect(element.querySelector('[role="status"]')).toBeNull();
  vi.mocked(eventBridge.showTaskContextMenu).mockRejectedValueOnce(new Error('native menu failed'));
  await openMenu();
  expect(element.textContent).toContain(t('Kontextmenü konnte nicht geöffnet werden'));
  expect(element.textContent).toContain('native menu failed');
});

it('ignores stale, Escape-cancelled and unmounted native popup responses', async () => {
  let finish!: (id: string) => void;
  const pendingMenu = () => new Promise<string>(resolve => { finish = resolve; });
  vi.mocked(eventBridge.showTaskContextMenu).mockImplementationOnce(pendingMenu);
  await openMenu();
  await openMenu();
  await act(async () => { finish('open-cache-explorer'); });
  expect(eventBridge.openPreviewCacheInExplorer).not.toHaveBeenCalled();
  vi.mocked(eventBridge.showTaskContextMenu).mockImplementationOnce(pendingMenu);
  await openMenu();
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await act(async () => { finish('open-cache-explorer'); });
  expect(close).not.toHaveBeenCalled();
  expect(eventBridge.openPreviewCacheInExplorer).not.toHaveBeenCalled();
  vi.mocked(eventBridge.showTaskContextMenu).mockImplementationOnce(pendingMenu);
  await openMenu();
  await act(async () => { clearButton().click(); });
  await act(async () => { finish('open-cache-explorer'); });
  expect(eventBridge.openPreviewCacheInExplorer).not.toHaveBeenCalled();
  vi.mocked(eventBridge.showTaskContextMenu).mockImplementationOnce(pendingMenu);
  await openMenu();
  act(() => root.unmount());
  unmounted = true;
  await act(async () => { finish('open-cache-explorer'); });
  expect(eventBridge.openPreviewCacheInExplorer).not.toHaveBeenCalled();
});
