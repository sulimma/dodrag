// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sourceDropTask, useSourceDrop } from './useSourceDrop';
import { SOURCE_MIME } from '../components/editor/targets';
import type { EditorTarget } from '../components/editor/types';

const bridge = vi.hoisted(() => ({ onFileDrop: vi.fn() }));
vi.mock('../bridge/eventBridge', () => ({ eventBridge: bridge }));
let host: HTMLDivElement, root: Root, unsubscribe: ReturnType<typeof vi.fn>;
let nativeDrop: (x: number, y: number, paths: string[]) => void;
let onDrop: ReturnType<typeof vi.fn>, onError: ReturnType<typeof vi.fn>;
let point: ReturnType<typeof vi.fn>, pointDescriptor: PropertyDescriptor | undefined;
function Harness({ drop = onDrop, error = onError }: {
  drop?: (taskId: string, sources: EditorTarget[]) => Promise<void>;
  error?: (error: unknown) => void;
}) { useSourceDrop(drop, error); return null; }
const drag = (target: Element, type: string, types = [SOURCE_MIME], raw = JSON.stringify({ kind: 'url', value: 'https://example.com/source' })) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const transfer = { types, getData: vi.fn(() => raw), dropEffect: 'none' };
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  act(() => target.dispatchEvent(event));
  return { event, transfer };
};
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onDrop = vi.fn().mockResolvedValue(undefined); onError = vi.fn(); unsubscribe = vi.fn();
  bridge.onFileDrop.mockImplementation(callback => { nativeDrop = callback; return unsubscribe; });
  pointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  point = vi.fn(); Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: point });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  if (pointDescriptor) Object.defineProperty(document, 'elementFromPoint', pointDescriptor);
  else Reflect.deleteProperty(document, 'elementFromPoint');
  vi.unstubAllGlobals();
});

it('finds the nearest source task but excludes description and log descendants', () => {
  host.innerHTML = '<div data-source-task-id="outer"><div data-source-task-id="inner"><span id="title">Title</span><div data-description-editor><span id="editor">Draft</span></div><div data-task-log><span id="log">Log</span></div></div></div>';
  expect(sourceDropTask(host.querySelector('#title'))).toBe('inner');
  expect(sourceDropTask(host.querySelector('#editor'))).toBeUndefined();
  expect(sourceDropTask(host.querySelector('#log'))).toBeUndefined();
  expect(sourceDropTask(host.querySelector('[data-description-editor]'))).toBeUndefined();
  expect(sourceDropTask(host.querySelector('[data-task-log]'))).toBeUndefined();
  expect(sourceDropTask(host)).toBeUndefined();
  expect(sourceDropTask(document.createTextNode('Title'))).toBeUndefined();
  expect(sourceDropTask(null)).toBeUndefined();
});

it('captures source MIME drops before row handlers and advertises copying', () => {
  host.innerHTML = '<div data-source-task-id="A"><span>Title</span></div>';
  const title = host.querySelector('span')!, rowDrop = vi.fn();
  host.addEventListener('drop', rowDrop);
  const over = drag(title, 'dragover');
  expect(over.event.defaultPrevented).toBe(true);
  expect(over.transfer.dropEffect).toBe('copy');
  const dropped = drag(title, 'drop');
  expect(dropped.event.defaultPrevented).toBe(true);
  expect(dropped.transfer.getData).toHaveBeenCalledWith(SOURCE_MIME);
  expect(rowDrop).not.toHaveBeenCalled();
  expect(onDrop).toHaveBeenCalledOnce();
  expect(onDrop).toHaveBeenCalledWith('A', [{ kind: 'url', value: 'https://example.com/source' }]);
});

it('leaves Files, ordinary task drags, editors, logs and unmarked areas to their existing handlers', () => {
  host.innerHTML = '<div data-source-task-id="A"><span id="title">Title</span><div data-description-editor><span id="editor">Draft</span></div><div data-task-log><span id="log">Log</span></div></div>';
  for (const [target, types] of [
    [host.querySelector('#title')!, ['Files']], [host.querySelector('#title')!, ['text/plain']],
    [host.querySelector('#editor')!, [SOURCE_MIME]], [host.querySelector('#log')!, [SOURCE_MIME]],
    [host, [SOURCE_MIME]],
  ] as [Element, string[]][]) {
    const bubble = vi.fn(); target.addEventListener('drop', bubble, { once: true });
    expect(drag(target, 'dragover', types).event.defaultPrevented).toBe(false);
    expect(drag(target, 'drop', types).event.defaultPrevented).toBe(false);
    expect(bubble).toHaveBeenCalledOnce();
  }
  expect(onDrop).not.toHaveBeenCalled();
});

it('rejects malformed or mismatched source payloads without appending', () => {
  host.innerHTML = '<div data-source-task-id="A"></div>';
  for (const raw of ['not JSON', '{}', JSON.stringify({ kind: 'path', value: 'https://example.com' }),
    JSON.stringify({ kind: 'url', value: 'javascript:alert(1)' })]) {
    expect(drag(host.firstElementChild!, 'drop', [SOURCE_MIME], raw).event.defaultPrevented).toBe(true);
  }
  expect(onDrop).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
});

it('resolves native coordinates to a task and appends all paths in one operation', () => {
  host.innerHTML = '<div data-source-task-id="A"><span>Title</span><div data-task-log><span id="log">Log</span></div></div>';
  point.mockReturnValue(host.querySelector('span'));
  const paths = ['C:\\Sources\\first.pdf', '\\\\server\\share\\folder'];
  act(() => nativeDrop(123, 456, paths));
  expect(point).toHaveBeenCalledWith(123, 456);
  expect(onDrop).toHaveBeenCalledOnce();
  expect(onDrop).toHaveBeenCalledWith('A', paths.map(value => ({ kind: 'path', value })));
  onDrop.mockClear();
  for (const target of [host.querySelector('#log'), host, null]) {
    point.mockReturnValue(target); act(() => nativeDrop(123, 456, paths));
  }
  point.mockReturnValue(host.querySelector('span'));
  act(() => nativeDrop(123, 456, []));
  expect(onDrop).not.toHaveBeenCalled();
});

it('reports invalid native paths and asynchronous failures through the latest callbacks', async () => {
  host.innerHTML = '<div data-source-task-id="A"></div>'; point.mockReturnValue(host.firstElementChild);
  act(() => nativeDrop(1, 2, ['C:\\bad|name.txt']));
  expect(onError).toHaveBeenCalledWith(expect.any(Error)); expect(onDrop).not.toHaveBeenCalled();
  const failure = new Error('Append fixture failure'), latestDrop = vi.fn().mockRejectedValue(failure), latestError = vi.fn();
  act(() => root.render(<Harness drop={latestDrop} error={latestError} />));
  await act(async () => { nativeDrop(1, 2, ['C:\\source.txt']); });
  await act(async () => { drag(host.firstElementChild!, 'drop'); });
  expect(latestDrop).toHaveBeenCalledTimes(2); expect(latestError).toHaveBeenCalledTimes(2);
  expect(latestError).toHaveBeenLastCalledWith(failure); expect(onDrop).not.toHaveBeenCalled();
  expect(bridge.onFileDrop).toHaveBeenCalledOnce();
});

it('unsubscribes native drops and removes global capture handlers on unmount', () => {
  host.innerHTML = '<div data-source-task-id="A"></div>';
  act(() => root.render(null));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(drag(host.firstElementChild!, 'dragover').event.defaultPrevented).toBe(false);
  expect(drag(host.firstElementChild!, 'drop').event.defaultPrevented).toBe(false);
  expect(onDrop).not.toHaveBeenCalled();
});
