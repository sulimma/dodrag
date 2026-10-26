// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskDescriptionEditor, type TaskDescriptionEditorHandle } from './TaskDescriptionEditor';
import type { EditorContextMenu } from './types';
import { getLanguage, setLanguage } from '../../i18n';
import type { Editor } from '@tiptap/react';
import { SOURCE_MIME } from './targets';
import { appendTaskSources } from '../../domain/taskSources';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const geometry: [string, PropertyDescriptor | undefined][] = [];
beforeEach(() => {
  for (const key of ['getClientRects', 'getBoundingClientRect']) {
    geometry.push([key, Object.getOwnPropertyDescriptor(Range.prototype, key)]);
    Object.defineProperty(Range.prototype, key, { configurable: true, value: () => key === 'getClientRects' ? [] : new DOMRect() });
  }
});
afterEach(() => {
  for (const [key, descriptor] of geometry.splice(0)) {
    if (descriptor) Object.defineProperty(Range.prototype, key, descriptor);
    else Reflect.deleteProperty(Range.prototype, key);
  }
});

it('roundtrips checklists, raw Windows paths, local markdown images and exposes native menus', async () => {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const ref = createRef<TaskDescriptionEditorHandle>();
  const onChange = vi.fn(); const onEscape = vi.fn(); const onError = vi.fn(); const onContextMenu = vi.fn();
  await act(async () => root.render(<TaskDescriptionEditor ref={ref} taskId="t1"
    description={'- [ ] Todo\n- [x] Done\n\n"G:\\Meine Ablage\\picture.svg"\n\n![alt](<C:\\Pictures\\a b.png>)'}
    onChange={onChange} onEscape={onEscape} onError={onError} onContextMenu={onContextMenu} />));
  expect(element.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
  // ProseMirror also inserts src-less cursor separator IMG nodes, which are not previews.
  expect(element.querySelectorAll('img[src]'), element.innerHTML).toHaveLength(2);
  expect(element.querySelector('img[src]')?.getAttribute('src')).toContain('/dodrag-media?taskId=t1&path=');
  await act(async () => element.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(onChange.mock.lastCall?.[0]).toContain('- [x] Todo');
  expect(onChange.mock.lastCall?.[0]).toContain('"G:\\Meine Ablage\\picture.svg"');
  expect(onChange.mock.lastCall?.[0]).toContain('![alt](<C:\\Pictures\\a b.png>)');
  act(() => element.querySelector('img[src]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const menu = onContextMenu.mock.lastCall?.[1] as EditorContextMenu;
  expect(menu.target).toEqual({ kind: 'path', value: 'G:\\Meine Ablage\\picture.svg' });
  expect(menu.items.map(item => item.id)).toContain('path:vscode');
  expect(menu.items.map(item => item.id)).toEqual(['path:explorer', 'path:vscode']);
  await menu.execute('editor:insertMermaid');
  expect(element.querySelector('pre')).toBeNull();
  act(() => element.querySelector('.tiptap')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(onEscape).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
  act(() => root.unmount()); element.remove();
});

it('pastes Markdown and HTML through editor menu and preserves UNC paths embedded in prose', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const onContextMenu = vi.fn(); const onChange = vi.fn();
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const readText = vi.fn(async () => '- [ ] pasted');
  const read = vi.fn(async () => [{ types: ['text/plain'], getType: async () => ({ text: async () => '- [ ] pasted' }) }]);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText, read } });
  try {
    await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description=""
      onChange={onChange} onEscape={vi.fn()} onError={vi.fn()} onContextMenu={onContextMenu} />));
    act(() => element.querySelector('.tiptap')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await act(async () => (onContextMenu.mock.lastCall![1] as EditorContextMenu).execute('editor:paste'));
    expect(element.querySelector('input[type=checkbox]')).not.toBeNull();
    read.mockResolvedValueOnce([{ types: ['text/html'], getType: async () => ({ text: async () => '<p><strong>HTML</strong></p><p>Open "\\\\Server\\Team Share\\a_b.svg" here</p>' }) }]);
    await act(async () => (onContextMenu.mock.lastCall![1] as EditorContextMenu).execute('editor:paste'));
    expect(element.querySelector('strong')!.textContent).toBe('HTML');
    expect(onChange.mock.lastCall![0]).toContain('\\\\Server\\Team Share\\a_b.svg');
    expect(element.querySelector('img[src]')!.getAttribute('data-target-value')).toBe('\\\\Server\\Team Share\\a_b.svg');
  } finally {
    act(() => root.unmount()); element.remove();
    if (original) Object.defineProperty(navigator, 'clipboard', original); else delete (navigator as any).clipboard;
  }
});

it('does not replace newer typing with stale saves, but synchronizes external undo after final ack', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const ref = createRef<TaskDescriptionEditorHandle>(); const onChange = vi.fn();
  const render = (description: string) => <TaskDescriptionEditor ref={ref} taskId="t1" description={description}
    onChange={onChange} onEscape={vi.fn()} onError={vi.fn()} onContextMenu={vi.fn()} />;
  await act(async () => root.render(render('Original')));
  act(() => ref.current!.insertFiles(['C:\\first.txt']));
  const first = onChange.mock.lastCall![0];
  act(() => ref.current!.insertFiles(['C:\\second.txt']));
  const second = onChange.mock.lastCall![0];
  const previousLanguage = getLanguage();
  act(() => setLanguage(previousLanguage === 'en' ? 'de' : 'en'));
  expect(element.textContent).toContain('C:\\second.txt');
  act(() => setLanguage(previousLanguage));
  await act(async () => root.render(render(first)));
  expect(element.textContent).toContain('C:\\second.txt');
  await act(async () => root.render(render(second)));
  await act(async () => root.render(render(first)));
  expect(element.textContent).not.toContain('C:\\second.txt');
  await act(async () => root.render(render('Original')));
  expect(element.querySelector('.tiptap')!.textContent).toBe('Original');
  act(() => root.unmount()); element.remove();
});

it('offers only URL actions on URLs and only editor actions on ordinary content', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const onContextMenu = vi.fn();
  try {
    await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description="[website](https://example.com)"
      onChange={vi.fn()} onEscape={vi.fn()} onError={vi.fn()} onContextMenu={onContextMenu} />));
    act(() => element.querySelector('a')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect((onContextMenu.mock.lastCall![1] as EditorContextMenu).items.map(item => item.id)).toEqual(['url:open']);
    act(() => element.querySelector('.tiptap')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect((onContextMenu.mock.lastCall![1] as EditorContextMenu).items.map(item => item.id)).toEqual([
      'editor:cut', 'editor:copy', 'editor:paste',
    ]);
  } finally { act(() => root.unmount()); element.remove(); }
});

it('roundtrips communication sources, decorates Markdown links and exposes the optional native create action', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const onContextMenu = vi.fn(), onCreateSourceTask = vi.fn(), onChange = vi.fn(), onError = vi.fn();
  const description = '[mail](mailto:person@example.org)\n\n[sip](sip:person@example.org)\n\n<tel:+493012345678>\n\nCall +49 (30) 1234_5678';
  try {
    await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description={description}
      onChange={onChange} onEscape={vi.fn()} onError={onError} onContextMenu={onContextMenu} onCreateSourceTask={onCreateSourceTask} />));
    const dom = element.querySelector('.tiptap') as HTMLElement & { editor: Editor };
    expect(element.querySelectorAll('[data-source-drag]')).toHaveLength(4);
    expect(dom.editor.getMarkdown()).toContain('+49 (30) 1234_5678');
    for (const value of ['mailto:person@example.org', 'sip:person@example.org', 'tel:+493012345678']) expect(dom.editor.getMarkdown()).toContain(value);
    act(() => element.querySelector('a')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    const menu = onContextMenu.mock.lastCall![1] as EditorContextMenu;
    expect(menu.items.map(item => item.id)).toEqual(['url:open', 'source:create']);
    expect(menu.items[0].label).toContain('📧');
    await act(async () => menu.execute('source:create'));
    expect(onCreateSourceTask).toHaveBeenCalledOnce();
    expect(onCreateSourceTask).toHaveBeenCalledWith({ kind: 'url', value: 'mailto:person@example.org' });
    const before = dom.editor.getMarkdown();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: [SOURCE_MIME] } });
    act(() => dom.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    expect(dom.editor.getMarkdown()).toBe(before);
    expect(onChange).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); element.remove(); }
});

it.each([
  ["AZaz09.!#$%&'*+-/=?^_`{|}~@Example.123", 'mailto:AZaz09.%21%23%24%25%26%27%2A%2B-%2F%3D%3F%5E_%60%7B%7C%7D~@Example.123'],
  ['"mail # ? % /"@example.org', 'mailto:%22mail%20%23%20%3F%20%25%20%2F%22@example.org'],
])('roundtrips raw email text and uses its encoded destination for the native menu: %s', async (address, destination) => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const onContextMenu = vi.fn(), onChange = vi.fn(), onError = vi.fn();
  try {
    await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description={address}
      onChange={onChange} onEscape={vi.fn()} onError={onError} onContextMenu={onContextMenu} />));
    const dom = element.querySelector('.tiptap') as HTMLElement & { editor: Editor };
    expect(dom.editor.state.doc.textContent).toBe(address);
    expect(dom.editor.getMarkdown()).toBe(address);
    const source = element.querySelector('[data-source-drag]')!;
    const target = element.querySelector('[data-target-kind]:not([data-source-drag])')!;
    expect(source.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(target.textContent).toBe(address);
    act(() => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect((onContextMenu.mock.lastCall![1] as EditorContextMenu).target).toEqual({ kind: 'url', value: destination });
    expect(onChange).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); element.remove(); }
});

it('appends sources as separate paragraphs outside an existing list', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const description = appendTaskSources('- item', [{ kind: 'url', value: 'mailto:person@example.org' }, { kind: 'path', value: 'C:\\source.txt' }]);
  try {
    await act(async () => root.render(<TaskDescriptionEditor taskId="t1" description={description}
      onChange={vi.fn()} onEscape={vi.fn()} onError={vi.fn()} onContextMenu={vi.fn()} />));
    const dom = element.querySelector('.tiptap') as HTMLElement & { editor: Editor };
    expect(dom.editor.state.doc.content.content.map(node => node.type.name)).toEqual(['bulletList', 'paragraph', 'paragraph']);
    expect(dom.editor.state.doc.firstChild!.textContent).toBe('item');
    expect(element.querySelectorAll('ul [data-source-drag]')).toHaveLength(0);
    expect(element.querySelectorAll('.tiptap > p [data-source-drag]')).toHaveLength(2);
  } finally { act(() => root.unmount()); element.remove(); }
});

it('reuses the editor across tasks while resetting undo, acknowledgements and image task IDs', async () => {
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const onChange = vi.fn(), onContextMenu = vi.fn();
  const render = (taskId: string, description: string) => <TaskDescriptionEditor taskId={taskId} description={description}
    onChange={onChange} onEscape={vi.fn()} onError={vi.fn()} onContextMenu={onContextMenu} />;
  const content = '"C:\\plain.png"\n\n![image](<C:\\node.png>)';
  try {
    await act(async () => root.render(render('first', content)));
    const dom = element.querySelector('.tiptap') as HTMLElement & { editor: Editor };
    const editor = dom.editor;
    act(() => editor.commands.insertContent('typed'));
    act(() => dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    const menu = onContextMenu.mock.lastCall![1] as EditorContextMenu;
    onChange.mockClear();
    await act(async () => root.render(render('second', content)));
    expect(element.querySelector('.tiptap')).toBe(dom);
    expect(dom.editor).toBe(editor);
    expect(editor.can().undo()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    const images = element.querySelectorAll<HTMLImageElement>('img[src]');
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.src).toContain('taskId=second&');
    await act(async () => menu.execute('editor:insertMermaid'));
    expect(editor.state.doc.textContent).not.toContain('graph TD');
    await act(async () => root.render(render('third', content)));
    for (const image of element.querySelectorAll<HTMLImageElement>('img[src]')) expect(image.src).toContain('taskId=third&');
  } finally { act(() => root.unmount()); element.remove(); }
});
