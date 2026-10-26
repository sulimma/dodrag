// @vitest-environment jsdom
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBridge } from './eventBridge';

// Exercise the installed implementation, not a mock of OnFileDrop. This optional
// contract suite requires the exact Go dependency to be present in the cache.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const home = env.USERPROFILE || env.HOME;
const cache = env.GOMODCACHE || `${home}/go/pkg/mod`;
const sourcePath = `${cache}/github.com/wailsapp/wails/v2@v2.9.2/internal/frontend/runtime/desktop/draganddrop.js`;

describe.skipIf(!ts.sys.fileExists(sourcePath))('Wails 2.9.2 native drop bridge contract', () => {
  let notify: (x: number, y: number, paths: string[]) => void;
  let unsubscribe: (() => void) | undefined;
  let target: HTMLDivElement;
  let post: ReturnType<typeof vi.fn>;
  let styles: ReturnType<typeof vi.fn>;
  const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

  beforeEach(() => {
    const source = ts.sys.readFile(sourcePath)!
      .replace(/^import .*;\r?\n/gm, '').replace(/\bexport function /g, 'function ');
    post = vi.fn();
    styles = vi.fn(() => ({ getPropertyValue: () => ' drop ' }));
    Object.assign(window, {
      wails: { flags: { enableWailsDragAndDrop: true, cssDropProperty: '--wails-drop-target', cssDropValue: 'drop' } },
      chrome: { webview: { postMessageWithAdditionalObjects: post } },
    });
    const eventsOn = vi.fn((name: string, callback: typeof notify) => {
      expect(name).toBe('wails:file-drop'); notify = callback;
    });
    window.runtime = new Function('window', 'document', 'getComputedStyle', 'chrome', 'EventsOn', 'EventsOff',
      `${source}\nreturn { OnFileDrop, OnFileDropOff, ResolveFilePaths };`)(
      window, document, styles, (window as any).chrome, eventsOn, vi.fn());
    target = document.createElement('div'); document.body.append(target);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
  });

  afterEach(() => {
    unsubscribe?.(); unsubscribe = undefined;
    target.remove(); vi.restoreAllMocks();
    if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
    else delete (document as any).elementFromPoint;
    delete window.runtime;
    delete (window as any).wails; delete (window as any).chrome;
  });

  function drop(stop = false) {
    const file = new File(['data'], 'example.txt');
    const event = new MouseEvent('drop', { bubbles: true, cancelable: true,
      clientX: 120, clientY: 75, screenX: 1320, screenY: 975 });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [
      { kind: 'file', getAsFile: () => file },
    ] } });
    target.addEventListener('drop', e => { e.preventDefault(); if (stop) e.stopPropagation(); }, { once: true });
    target.dispatchEvent(event);
    return file;
  }

  it('resolves files after child preventDefault and delivers unchanged client coordinates and native paths', () => {
    const callback = vi.fn(); unsubscribe = eventBridge.onFileDrop(callback);
    const file = drop();
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('file:drop:120:75', [file]);
    const paths = ['C:\\Files\\example.txt', 'G:\\Meine Ablage\\Folder'];
    notify(120, 75, paths);
    expect(document.elementFromPoint).toHaveBeenCalledWith(120, 75);
    expect(styles).toHaveBeenCalledWith(target);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(120, 75, paths);
  });

  it('cannot resolve native paths when a child stops propagation', () => {
    unsubscribe = eventBridge.onFileDrop(vi.fn());
    drop(true);
    expect(post).not.toHaveBeenCalled();
  });

  it('shares one transport between app and detail panel until the last subscriber leaves', () => {
    const app = vi.fn(), panel = vi.fn();
    unsubscribe = eventBridge.onFileDrop(app);
    const removePanel = eventBridge.onFileDrop(panel);
    try {
      notify(120, 75, ['C:\\Files\\example.txt']);
      expect(app).toHaveBeenCalledOnce(); expect(panel).toHaveBeenCalledOnce();
      removePanel();
      notify(120, 75, ['C:\\Files\\second.txt']);
      expect(app).toHaveBeenCalledTimes(2); expect(panel).toHaveBeenCalledOnce();
      drop(); expect(post).toHaveBeenCalledOnce();
    } finally { removePanel(); }
  });

  it('filters the computed property on the hit element and removes transport listeners on cleanup', () => {
    const callback = vi.fn(); unsubscribe = eventBridge.onFileDrop(callback);
    styles.mockReturnValue({ getPropertyValue: () => 'none' });
    notify(120, 75, ['C:\\Files\\example.txt']);
    expect(callback).not.toHaveBeenCalled();
    styles.mockReturnValue({ getPropertyValue: () => 'drop' });
    notify(120, 75, ['C:\\Files\\example.txt']);
    expect(callback).toHaveBeenCalledOnce();
    unsubscribe(); unsubscribe = undefined;
    drop();
    expect(post).not.toHaveBeenCalled();
  });
});
