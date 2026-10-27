// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShortcutHelp } from './ShortcutHelp';
import { ALERT_TYPES, EMOTICONS } from './editor/MarkdownFeatures';
import { SYMBOL_GROUPS } from './editor/SymbolReplacements';
import { MERMAID_TEMPLATES } from './editor/MermaidTemplates';
import { getLanguage, setLanguage, supportedLanguages, t } from '../i18n';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

let host: HTMLDivElement, root: Root, previous: ReturnType<typeof getLanguage>;
beforeEach(() => {
  previous = getLanguage();
  mermaid.render.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>A</text></svg>' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); setLanguage(previous); vi.unstubAllGlobals();
});
const render = (props: React.ComponentProps<typeof ShortcutHelp>) => act(() => root.render(<ShortcutHelp {...props} />));

it('localizes the requested shortcuts and their scope in all 15 languages without advertising Ctrl+N', () => {
  render({ open: true, onClose: vi.fn() });
  expect(supportedLanguages).toHaveLength(15);
  for (const language of supportedLanguages) {
    act(() => setLanguage(language));
    const rows = [...host.querySelectorAll('kbd')].map(kbd => ({
      shortcut: kbd.textContent!.trim(),
      label: kbd.previousElementSibling!.textContent,
      notes: [...kbd.previousElementSibling!.querySelectorAll('small')].map(note => note.textContent),
    }));
    for (const [key, shortcut] of [
      ['Hilfe öffnen', 'F1'],
      ['Kontextmenü öffnen', `Shift+F10 / ${t('Kontextmenütaste')}`],
      ['Nächsten Bereich fokussieren', 'F6'],
      ['Vorherigen Bereich fokussieren', 'Shift+F6'],
      ['Einstellungen öffnen', 'Ctrl+,'],
    ]) expect(rows.filter(row => row.shortcut === shortcut)).toEqual([{ shortcut, label: t(key), notes: [] }]);
    for (const [key, shortcut] of [
      ['Liste', 'Ctrl+1'], ['Netzplan', 'Ctrl+2'], ['Gantt', 'Ctrl+3'], ['Details ein-/ausblenden', 'Ctrl+Shift+D'],
    ]) expect(rows.filter(row => row.shortcut === shortcut)).toEqual([{
      shortcut, label: t(key) + t('Nur Hauptansicht'), notes: [t('Nur Hauptansicht')],
    }]);
    expect(rows.filter(row => row.shortcut === 'Ctrl++')).toEqual([{
      shortcut: 'Ctrl++',
      label: t('Wiedervorlage +1 Tag') + t('Hauptansicht und Mini-Ansicht') + t('Nur außerhalb Texteingaben. Offener ausgewählter Task erforderlich.'),
      notes: [t('Hauptansicht und Mini-Ansicht'), t('Nur außerhalb Texteingaben. Offener ausgewählter Task erforderlich.')],
    }]);
    expect(host.textContent).not.toContain('Ctrl+N');
    expect(rows.some(row => row.label === t('N: Eingabe für neuen Task fokussieren'))).toBe(true);
  }
});

it('names one modal dialog, links both pages, traps Tab and restores focus', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const onClose = vi.fn();
  render({ open: true, onClose });
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe(t('Tastenkürzel & Drag-and-Drop Steuerung'));
  const buttons = dialog.querySelectorAll('button');
  expect(document.activeElement).toBe(buttons[0]);
  act(() => buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(buttons[2]);
  act(() => buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(buttons[0]);
  act(() => buttons[2].click());
  expect(host.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.querySelector('h3')!.textContent).toBe(t('Markdown-Syntax'));
  expect(buttons[2].getAttribute('aria-current')).toBe('page');
  act(() => buttons[1].click());
  expect(dialog.querySelector('h3')!.textContent).toBe(t('Tastenkürzel & Drag-and-Drop Steuerung'));
  act(() => buttons[0].click()); expect(onClose).toHaveBeenCalledOnce();
  render({ open: false, onClose }); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it('reactively localizes every syntax helper in all languages while retaining syntax markers', () => {
  render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
  for (const language of supportedLanguages) {
    act(() => setLanguage(language));
    const headings = [...host.querySelectorAll('h4')].map(node => node.textContent);
    const keys = ['Überschrift', 'Absatz', 'Fett', 'Kursiv', 'Durchgestrichen', 'Code', 'Listen', 'Zitat', 'Codeblock', 'GitHub Alerts', 'Mermaid-Diagramm', 'Formel', 'Formelblock', 'Link', 'Bild', 'Emotion-Shortcuts', 'Sonderzeichen', 'Mermaid'];
    expect(headings).toEqual(keys.map(key => t(key)));
    expect(host.querySelector('h3')!.textContent).toBe(t('Markdown-Syntax'));
    expect(host.querySelector('p')!.textContent).toBe(t('Markdown für Beschreibung und Log. Syntaxzeichen bleiben in jeder Sprache gleich.'));
    const text = t('Text');
    const examples = [...host.querySelectorAll('pre code')].map(node => node.textContent);
    expect(examples).toEqual([
      [1, 2, 3, 4, 5, 6].map(level => `${'#'.repeat(level)} ${text}`).join('\n'),
      `${text}\n\n${text}`, `**${text}**`, `*${text}*`, `~~${text}~~`, `\`${text}\``,
      `- ${text}\n- ${text}\n\n1. ${text}\n2. ${text}\n\n- [ ] ${text}\n- [x] ${text}`,
      `> ${text}`, `\`\`\`text\n${text}\n\`\`\``,
      ALERT_TYPES.map(({ type, labelKey }) => `> [!${type}]\n> ${t(labelKey)}`).join('\n\n'),
      `\`\`\`mermaid\ngraph LR\n  A[${t('Start')}] --> B[${t('Ende')}]\n\`\`\``,
      '$E = mc^2$', '$$\n\\frac{a}{b} = c\n$$', `[${text}](https://example.com)`,
      `![${t('Bildbeschreibung')}](https://example.com/image.png)`,
      ...MERMAID_TEMPLATES.map(({ source }) => `\`\`\`mermaid\n${source}\n\`\`\``),
    ]);
    const emoticons = [...host.querySelectorAll('ul')].find(list => list.getAttribute('aria-label') === t('Emotion-Shortcuts'))!;
    expect(emoticons.querySelectorAll('li')).toHaveLength(EMOTICONS.length);
    expect([...emoticons.querySelectorAll('li code')].map(node => node.textContent)).toEqual(EMOTICONS.map(item => item.shortcut));
    expect([...emoticons.querySelectorAll('li span')].map(node => node.textContent)).toEqual(EMOTICONS.map(item => item.emoji));
    expect([...host.querySelectorAll('h5')].map(node => node.textContent)).toEqual(SYMBOL_GROUPS.map(group => t(group.labelKey)));
    for (const { labelKey, items } of SYMBOL_GROUPS) {
      const list = [...host.querySelectorAll('ul')].find(node => node.getAttribute('aria-label') === t(labelKey))!;
      expect(list.classList.contains('grid-cols-3')).toBe(true);
      expect([...list.querySelectorAll('li')].map(node => [...node.querySelectorAll('code')].map(code => code.textContent)))
        .toEqual(items.map(({ shortcut, symbol, latex }) => [shortcut, latex ? `$${latex}$` : symbol]));
    }
    expect([...host.querySelectorAll('summary')].map(node => node.textContent)).toEqual([t('Mermaid-Vorschau'), ...MERMAID_TEMPLATES.map(({ labelKey }) => t(labelKey))]);
    const paragraphs = [...host.querySelectorAll('p')].map(node => node.textContent);
    for (const key of [
      'Ersetzungen beim Tippen nach Leerzeichen oder sicherer Satzgrenze; auch beim Einfügen. Bestehende Inhalte bleiben unverändert. Für -- sind Leerzeichen auf beiden Seiten nötig.',
      'Brüche nach einem Leerzeichen: 1/2, 1/4 und 3/4 werden Unicode-Zeichen; andere N/D werden Inline-LaTeX. Höchstens 12 Ziffern je Teil; Nenner 0 bleibt unverändert.',
      'Keine Ersetzung in Code, Mermaid, Formeln, Links, URLs, Dateipfaden oder verketteten Datumsangaben.',
    ]) expect(paragraphs).toContain(t(key));
  }
  act(() => host.querySelectorAll('nav button')[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => setLanguage('en'));
  expect(host.querySelector('h3')!.textContent).toBe(t('Tastenkürzel & Drag-and-Drop Steuerung'));
  expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe(t('Hilfe-Seiten'));
});

it('includes keyboard-accessible Mermaid examples in the syntax page focus trap', () => {
  render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
  const close = host.querySelector<HTMLButtonElement>('button')!;
  const summaries = host.querySelectorAll<HTMLElement>('summary');
  const last = summaries[summaries.length - 1];
  act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
});

it('uses the requested initial page on each reopening', () => {
  const onClose = vi.fn();
  render({ open: true, initialPage: 'syntax', onClose });
  act(() => host.querySelectorAll<HTMLButtonElement>('nav button')[0].click());
  render({ open: false, initialPage: 'syntax', onClose });
  render({ open: true, initialPage: 'syntax', onClose });
  expect(host.querySelector('h3')!.textContent).toBe(t('Markdown-Syntax'));
  render({ open: true, initialPage: 'shortcuts', onClose });
  expect(host.querySelector('h3')!.textContent).toBe(t('Tastenkürzel & Drag-and-Drop Steuerung'));
});

async function toggle(details: HTMLDetailsElement, open: boolean) {
  await act(async () => {
    details.open = open;
    details.dispatchEvent(new Event('toggle'));
  });
}

it('lazily renders every Mermaid example with strict security and preserves its source', async () => {
  render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
  expect(mermaid.render).not.toHaveBeenCalled();
  const details = [...host.querySelectorAll('details')];
  expect(details).toHaveLength(MERMAID_TEMPLATES.length + 1);
  for (const [index, example] of details.entries()) {
    const code = example.querySelector('code')!.textContent;
    await toggle(example, true);
    await vi.waitFor(async () => { await act(async () => {}); expect(example.querySelector('svg')).not.toBeNull(); });
    expect(mermaid.render.mock.calls[index][1]).toBe(code!.slice('```mermaid\n'.length, -'\n```'.length));
    expect(example.querySelector('code')!.textContent).toBe(code);
    expect(example.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(t('Mermaid-Vorschau'));
    await toggle(example, false);
    expect(example.querySelector('svg')).toBeNull();
  }
  expect(mermaid.initialize).toHaveBeenCalledWith({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
  expect(document.querySelector('[data-help-mermaid-render]')).toBeNull();
});

it('opens the official Mermaid syntax documentation in the external browser without navigating the app', () => {
  const previousRuntime = window.runtime;
  const open = vi.fn(); window.runtime = { ...previousRuntime, BrowserOpenURL: open };
  try {
    render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
    const link = host.querySelector<HTMLAnchorElement>('a[href="https://mermaid.js.org/intro/syntax-reference.html"]')!;
    expect(link).not.toBeNull();
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    for (const language of supportedLanguages) {
      act(() => setLanguage(language));
      expect(link.textContent).toBe(t('Mermaid-Syntaxdokumentation'));
      expect(link.title).toBe(t('Im Browser öffnen'));
    }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => link.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(link.href);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  } finally { window.runtime = previousRuntime; }
});

it('sanitizes SVG scripts, event handlers and unsafe URLs while keeping HTML labels', async () => {
  mermaid.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><text>A</text></a><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)">B<img src="x" onerror="alert(1)"></div></foreignObject></svg>' });
  render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
  await toggle(host.querySelector('details')!, true);
  await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('details svg')).not.toBeNull(); });
  const svg = host.querySelector('details svg')!;
  expect(svg.querySelector('script, [onload], [onclick], [onerror], [href^="javascript:"]')).toBeNull();
  expect(svg.hasAttribute('onload')).toBe(false);
  expect(svg.querySelector('foreignObject')!.textContent).toContain('B');
});

it('removes temporary render DOM and ignores async completions after close or unmount', async () => {
  const pending: ((value: { svg: string }) => void)[] = [];
  mermaid.render.mockImplementation((_id, _source, container) => {
    container.innerHTML = '<svg></svg>';
    return new Promise(resolve => pending.push(resolve));
  });
  const props = { open: true, initialPage: 'syntax' as const, onClose: vi.fn() };
  render(props);
  const details = host.querySelector('details')!;
  await toggle(details, true);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  expect(document.querySelector('[data-help-mermaid-render]')).not.toBeNull();
  await toggle(details, false);
  expect(document.querySelector('[data-help-mermaid-render]')).toBeNull();
  await act(async () => pending[0]({ svg: '<svg id="stale"></svg>' }));
  expect(details.querySelector('svg')).toBeNull();
  await toggle(details, true);
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  render({ ...props, open: false });
  expect(document.querySelector('[data-help-mermaid-render]')).toBeNull();
  await act(async () => pending[1]({ svg: '<svg id="unmounted"></svg>' }));
  expect(document.querySelector('#stale, #unmounted, [data-help-mermaid-render]')).toBeNull();
});

it('localizes preview errors and labels reactively without applying symbol replacement to help', async () => {
  mermaid.render.mockRejectedValue(new Error('technical failure'));
  render({ open: true, initialPage: 'syntax', onClose: vi.fn() });
  await toggle(host.querySelector('details')!, true);
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  for (const language of supportedLanguages) {
    await act(async () => { setLanguage(language); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('[role="alert"]')).not.toBeNull(); });
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(t('Mermaid-Diagramm konnte nicht gerendert werden'));
    expect(host.querySelector('summary')!.textContent).toBe(t('Mermaid-Vorschau'));
    expect(host.querySelector('details code')!.textContent).toContain(`A[${t('Start')}] --> B[${t('Ende')}]`);
    expect(host.textContent).toContain('1/2');
    expect(host.textContent).toContain(' -- ');
    const syntax = host.querySelector('details')!.parentElement!.parentElement!;
    expect(syntax.style.fontVariantLigatures).toBe('none');
    expect(syntax.style.fontFeatureSettings).toBe('"liga" 0, "clig" 0, "calt" 0');
  }
  expect(document.querySelector('[data-help-mermaid-render]')).toBeNull();
});
