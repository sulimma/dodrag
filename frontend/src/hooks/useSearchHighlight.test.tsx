// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { searchRanges, useSearchHighlight, paintSearchFields } from './useSearchHighlight';
it('highlights every literal occurrence across inline markup, line breaks and editor blocks without changing DOM or selection', () => {
  const root = document.createElement('div'); document.body.append(root);
  root.innerHTML = '<p>Al<strong>pha</strong><br>beta Alpha   BETA</p><div contenteditable="true"><p>Alpha</p><p>beta</p></div><div hidden>Alpha beta</div><div style="visibility:hidden">Alpha beta</div>';
  const before = root.innerHTML;
  const selection = window.getSelection()!, caret = document.createRange(); caret.selectNodeContents(root.querySelector('strong')!);
  selection.removeAllRanges(); selection.addRange(caret);
  const ranges = searchRanges(root, 'alpha beta');
  expect(ranges).toHaveLength(3);
  expect(ranges[0].startContainer.textContent).toBe('Al');
  expect(ranges[0].endContainer.textContent).toContain('beta');
  expect(root.innerHTML).toBe(before); expect(selection.toString()).toBe('pha');
  root.remove();
});
it('refreshes painted ranges when virtual rows or editor text change and clears them on reset', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const registry = new Map<string, { ranges: Range[] }>();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Fixture({ query }: { query: string }) { useSearchHighlight(query); return <p>needle</p>; }
  try {
    await act(async () => root.render(<Fixture query="needle" />));
    expect(registry.get('omni-search')?.ranges).toHaveLength(1);
    const row = document.createElement('p'); row.textContent = 'NEEDLE'; host.append(row);
    await act(async () => { await Promise.resolve(); });
    expect(registry.get('omni-search')?.ranges).toHaveLength(2);
    row.textContent = 'changed'; await act(async () => { await Promise.resolve(); });
    expect(registry.get('omni-search')?.ranges).toHaveLength(1);
    row.remove(); await act(async () => root.render(<Fixture query="" />));
    expect(registry.has('omni-search')).toBe(false);
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it('handles whitespace-only queries and trailing block boundaries without invalid ranges', () => {
  const host = document.createElement('div'); host.innerHTML = '<p>Alpha</p><p>beta</p>';
  expect(() => searchRanges(host, ' ')).not.toThrow();
  expect(searchRanges(host, ' ')).toEqual([]);
});
it('paints editable note matches using an inert mirror without touching the field value, focus or selection', () => {
  const host = document.createElement('div'); document.body.append(host);
  host.innerHTML = '<textarea>alpha\nBETA + alpha beta</textarea>';
  const field = host.querySelector('textarea')!, layer = document.createElement('div');
  document.body.append(layer);
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100 } as DOMRect);
  Object.defineProperty(field, 'clientWidth', { configurable: true, value: 200 });
  field.focus(); field.setSelectionRange(3, 3);
  paintSearchFields(layer, 'Alpha beta');
  expect(layer.querySelectorAll('mark')).toHaveLength(2);
  expect(field.value).toBe('alpha\nBETA + alpha beta');
  expect(document.activeElement).toBe(field); expect(field.selectionStart).toBe(3);
  paintSearchFields(layer, 'absent'); expect(layer.textContent).toBe('');
  host.remove(); layer.remove(); vi.restoreAllMocks();
});
