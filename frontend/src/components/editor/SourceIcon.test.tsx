// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { eventBridge } from '../../bridge/eventBridge';
import { SourceIcon, createSourceIcon } from './SourceIcon';
import { SOURCE_MIME } from './targets';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('uses native path classification, including folders with extensions and extensionless files', async () => {
  const check = vi.spyOn(eventBridge, 'getPathKind').mockResolvedValueOnce('directory').mockResolvedValueOnce('file');
  const element = document.createElement('div'); const root = createRoot(element);
  try {
    await act(async () => root.render(<SourceIcon target={{ kind: 'path', value: 'C:\\folder.txt' }} />));
    expect(element.textContent).toBe('📂');
    await act(async () => root.render(<SourceIcon target={{ kind: 'path', value: 'C:\\no-extension' }} />));
    expect(element.textContent).toBe('🖹');
    expect(check.mock.calls).toEqual([['C:\\folder.txt'], ['C:\\no-extension']]);
  } finally { act(() => root.unmount()); check.mockRestore(); }
});

it('drags only the common copy payload from the icon without moving editor content', () => {
  const target = { kind: 'url' as const, value: 'mailto:person@example.org' };
  const icon = createSourceIcon(target);
  const dataTransfer = { clearData: vi.fn(), setData: vi.fn(), effectAllowed: '' };
  const event = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  const parent = document.createElement('div'); parent.append(icon);
  const bubble = vi.fn(); parent.addEventListener('dragstart', bubble);
  icon.dispatchEvent(event);
  expect(icon.textContent).toBe('📧');
  expect(icon.draggable).toBe(true);
  expect(dataTransfer.effectAllowed).toBe('copy');
  expect(dataTransfer.setData).toHaveBeenCalledOnce();
  expect(dataTransfer.setData).toHaveBeenCalledWith(SOURCE_MIME, JSON.stringify(target));
  expect(bubble).not.toHaveBeenCalled();
});
