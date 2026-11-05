// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskContextMenu, taskDirectoryPaths, shortenedDirectoryPath } from './TaskContextMenu';
import { eventBridge } from '../bridge/eventBridge';
import type { TaskState } from '../domain/types';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.restoreAllMocks());

it('collects unique directories from description and log, skipping files, URLs and unavailable paths', async () => {
  const kind = vi.spyOn(eventBridge, 'getPathKind').mockImplementation(async path => {
    if (path.includes('missing')) throw new Error('missing');
    return path.includes('.txt') ? 'file' : 'directory';
  });
  const task = { description: '"C:\\My project" https://example.com C:\\file.txt C:\\missing',
    logEntries: [{ text: '"c:\\my project\\" "D:\\Other"' }] } as TaskState;
  expect(await taskDirectoryPaths(task)).toEqual(['C:\\My project\\', 'D:\\Other\\']);
  expect(kind).toHaveBeenCalledTimes(4);
});

it('retains the drive and trailing directory when shortening', () => {
  const path = 'C:\\' + 'long-directory\\'.repeat(8) + 'mein_projekt\\';
  const label = shortenedDirectoryPath(path);
  expect(label.startsWith('C:\\...')).toBe(true);
  expect(label.endsWith('mein_projekt\\')).toBe(true);
  expect(label.length).toBe(48);
  expect(shortenedDirectoryPath('C:\\short\\')).toBe('C:\\short\\');
});

it('opens the full folder from the shared menu and reports failures after the menu closes', async () => {
  vi.spyOn(eventBridge, 'getPathKind').mockResolvedValue('directory');
  const show = vi.spyOn(eventBridge, 'showTaskContextMenu').mockResolvedValue('directory:0');
  const failure = new Error('Explorer failed');
  const open = vi.spyOn(eventBridge, 'openFolderInExplorer').mockRejectedValue(failure);
  const element = document.createElement('div'); const root = createRoot(element);
  const onError = vi.fn();
  const task = { id: 't1', completed: true, description: '"C:\\My project"', logEntries: [] } as unknown as TaskState;
  await act(async () => root.render(<TaskContextMenu task={task} databaseKey="db"
    contextMenu={{ taskId: 't1', x: 0, y: 0 }} onClose={() => root.unmount()} onError={onError}
    onToggleActive={vi.fn()} onSetConfiguredDate={vi.fn()} onRemovePredecessor={vi.fn()}
    onCompleteTask={vi.fn()} onReopenTask={vi.fn()} onOpenCopy={vi.fn()} />));
  expect(show.mock.calls[0][0].map(item => [item.id, item.disabled, !!item.separator])).toEqual([
    ['reopen', false, false], ['open-copy', false, false], ['directories:separator', false, true],
    ['directories:heading', true, false], ['directory:0', false, false],
  ]);
  expect(open).toHaveBeenCalledWith('C:\\My project\\', false);
  expect(onError).toHaveBeenCalledWith(failure);
});
