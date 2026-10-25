import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { ALERT_TYPES, EMOTICONS } from './editor/MarkdownFeatures';
import { SYMBOL_GROUPS } from './editor/SymbolReplacements';
import { MERMAID_TEMPLATES } from './editor/MermaidTemplates';
export type HelpPage = 'shortcuts' | 'syntax';
let helpMermaidModule: Promise<typeof import('mermaid')['default']> | undefined;
let helpDiagramSequence = 0;
const mermaidDocumentationURL = 'https://mermaid.js.org/intro/syntax-reference.html';

function MermaidExample({ label, source }: { label: string; source: string }) {
  useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [svg, setSVG] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    let renderHost: HTMLDivElement | undefined;
    setSVG(''); setFailed(false);
    helpMermaidModule ??= import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
      return mermaid;
    });
    void Promise.all([helpMermaidModule, import('dompurify')]).then(async ([mermaid, { default: purify }]) => {
      if (!active) return;
      renderHost = document.createElement('div');
      renderHost.dataset.helpMermaidRender = 'true';
      renderHost.style.position = 'absolute'; renderHost.style.left = '-100000px';
      document.body.append(renderHost);
      try {
        const { svg: rendered } = await mermaid.render(`dodrag-help-mermaid-${++helpDiagramSequence}`, source, renderHost);
        // Mermaid HTML labels need foreignObject; DOMPurify still checks its HTML descendants.
        if (active) setSVG(purify.sanitize(rendered, {
          ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { foreignobject: true },
        }));
      } finally { renderHost.remove(); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; renderHost?.remove(); };
  }, [expanded, source]);
  const example = `\`\`\`mermaid\n${source}\n\`\`\``;
  return <details className="rounded border border-slate-200 p-2" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{label}</summary>
    {expanded && svg && <div role="img" aria-label={t('Mermaid-Vorschau')}
      className="mt-2 overflow-auto [&_svg]:max-w-full" style={{ zoom: 0.75 }} dangerouslySetInnerHTML={{ __html: svg }} />}
    {expanded && failed && <p role="alert" className="mt-2 text-red-700">{t('Mermaid-Diagramm konnte nicht gerendert werden')}</p>}
    <pre className="mt-2 whitespace-pre-wrap break-words"><code>{example}</code></pre>
  </details>;
}

// Summarizes the active task, drag, and navigation shortcuts.
export function ShortcutHelp({
  open,
  onClose,
  initialPage = 'shortcuts',
}: {
  open: boolean;
  onClose: () => void;
  initialPage?: HelpPage;
}) {
  useLanguage();
  const [page, setPage] = useState<HelpPage>(initialPage);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setPage(initialPage);
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open, initialPage]);
  // ponytail: No presence/opacity/scale animation: avoid WebView2 layer flicker and delayed removal.
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-4"
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={event => {
              if (event.key !== 'Tab') return;
              const buttons = dialog.current?.querySelectorAll<HTMLElement>('button, summary');
              if (!buttons?.length) return;
              const first = buttons[0], last = buttons[buttons.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-slate-200 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 id={titleId} className="text-sm font-bold text-slate-900">
                {page === 'syntax' ? t('Markdown-Syntax') : t('Tastenkürzel & Drag-and-Drop Steuerung')}
              </h3>
              <button
                ref={close}
                type="button"
                onClick={onClose}
                aria-label={t('Schließen')}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav aria-label={t('Hilfe-Seiten')} className="flex gap-2 text-xs">
              <button type="button" aria-current={page === 'shortcuts' ? 'page' : undefined}
                onClick={() => setPage('shortcuts')} className="rounded border px-3 py-1.5 text-sky-700 hover:bg-sky-50 focus-visible:outline focus-visible:outline-sky-500">{t('Tastenkürzel')}</button>
              <button type="button" aria-current={page === 'syntax' ? 'page' : undefined}
                onClick={() => setPage('syntax')} className="rounded border px-3 py-1.5 text-sky-700 hover:bg-sky-50 focus-visible:outline focus-visible:outline-sky-500">{t('Markdown-Syntax')}</button>
            </nav>
            {page === 'syntax' ? <SyntaxHelp /> : <>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>
                  {t('Abhängigkeit hinzufügen (Vorgänger → abhängiger Task)')}
                </span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Abhängigen Task auf seinen Vorgänger ziehen (A auf B: B → A)')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Alt: an der gezogenen Aufgabe gespeicherte Kanten Richtung Ziel lösen (Vorgänger und Nachfolger, kein ganzer Pfad)')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Alt+Task-Ziehen auf anderen Task')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Markierte Abhängigkeit(en) löschen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Klick / Strg- / Shift+Klick → Entf / Backspace')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Task aktivieren / deaktivieren')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Space / A / Rechtsklick')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Task in-place umbenennen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('F2 / E / Enter / Doppelklick')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('N: Eingabe für neuen Task fokussieren')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  {t('Enter (Eingabe): Task anlegen')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Ausgewählten Task erledigen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  Del / D
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Erneut öffnen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  O
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Startdatum auf Heute setzen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  T
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Kompaktansicht / Hauptansicht wiederherstellen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Ctrl+M
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-b border-slate-100">
                <span>{t('Undo / Redo')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 whitespace-normal">
                  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>{t('Tasks auswählen / Auswahl aufheben')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  ↑ / ↓ / Esc
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1 border-t border-slate-100">
                <span>{t('Ansicht zum Anfang / Ende scrollen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Pos1 / Ende')}
                </kbd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1">
                <span>{t('Seitenweise scrollen')}</span>
                <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700">
                  {t('Bild ↑ / Bild ↓')}
                </kbd>
              </div>
            </div>
            <p className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              {t('Tastenkürzel gelten im aktiven Fenster, auch in der Mini-Ansicht und bei fokussierten Buttons. In Texteingaben bleiben Buchstaben Texteingaben. Einstellungen und Hilfe sperren App-Aktionen. Escape schließt Hilfe, Kontextmenü oder Editor.')}
            </p>
            </>}
          </div>
        </div>
      )}
    </>
  );
}

function SyntaxHelp() {
  const text = t('Text');
  const examples = [
    [t('Überschrift'), [1, 2, 3, 4, 5, 6].map(level => `${'#'.repeat(level)} ${text}`).join('\n')],
    [t('Absatz'), `${text}\n\n${text}`],
    [t('Fett'), `**${text}**`],
    [t('Kursiv'), `*${text}*`],
    [t('Durchgestrichen'), `~~${text}~~`],
    [t('Code'), `\`${text}\``],
    [t('Listen'), `- ${text}\n- ${text}\n\n1. ${text}\n2. ${text}\n\n- [ ] ${text}\n- [x] ${text}`],
    [t('Zitat'), `> ${text}`],
    [t('Codeblock'), `\`\`\`text\n${text}\n\`\`\``],
    [t('GitHub Alerts'), ALERT_TYPES.map(({ type, labelKey }) => `> [!${type}]\n> ${t(labelKey)}`).join('\n\n')],
    [t('Mermaid-Diagramm'), `\`\`\`mermaid\ngraph LR\n  A[${t('Start')}] --> B[${t('Ende')}]\n\`\`\``],
    [t('Formel'), '$E = mc^2$'],
    [t('Formelblock'), '$$\n\\frac{a}{b} = c\n$$'],
    [t('Link'), `[${text}](https://example.com)`],
    [t('Bild'), `![${t('Bildbeschreibung')}](https://example.com/image.png)`],
  ];
  return <div className="space-y-3 text-xs text-slate-600" style={{ fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "clig" 0, "calt" 0' }}>
    <p>{t('Markdown für Beschreibung und Log. Syntaxzeichen bleiben in jeder Sprache gleich.')}</p>
    {examples.map(([label, example], index) => <section key={index}>
      <h4 className="font-semibold text-slate-800 mb-1">{label}</h4>
      {label === t('Mermaid-Diagramm') ? <MermaidExample label={t('Mermaid-Vorschau')} source={example.slice('```mermaid\n'.length, -'\n```'.length)} /> :
        <pre className="rounded bg-slate-100 border border-slate-200 p-2 whitespace-pre-wrap break-words"><code>{example}</code></pre>}
    </section>)}
    <section>
      <h4 className="font-semibold text-slate-800 mb-1">{t('Emotion-Shortcuts')}</h4>
      <ul aria-label={t('Emotion-Shortcuts')} className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {EMOTICONS.map(({ shortcut, emoji, color }) => <li key={shortcut} className="flex items-center gap-2 rounded bg-slate-100 px-2 py-1">
          <span aria-hidden="true" style={{ color, filter: shortcut === '(off)' ? 'grayscale(1)' : undefined }}>{emoji}</span>
          <code>{shortcut}</code>
        </li>)}
      </ul>
    </section>
    <section className="space-y-2">
      <h4 className="font-semibold text-slate-800">{t('Sonderzeichen')}</h4>
      <p>{t('Ersetzungen beim Tippen nach Leerzeichen oder sicherer Satzgrenze; auch beim Einfügen. Bestehende Inhalte bleiben unverändert. Für -- sind Leerzeichen auf beiden Seiten nötig.')}</p>
      {SYMBOL_GROUPS.map(({ labelKey, items }) => <div key={labelKey}>
        <h5 className="font-semibold text-slate-800 mb-1">{t(labelKey)}</h5>
        <ul aria-label={t(labelKey)} className="grid grid-cols-3 gap-1">
          {items.map(({ shortcut, symbol, latex }) => <li key={shortcut} className="flex flex-wrap items-center gap-x-2 rounded bg-slate-100 px-2 py-1 min-w-0">
            <code className="whitespace-pre-wrap break-all">{shortcut}</code>
            <span aria-hidden="true">{'\u2192'}</span>
            <code className="whitespace-pre-wrap break-all">{latex ? `$${latex}$` : symbol}</code>
          </li>)}
        </ul>
      </div>)}
      <p>{t('Brüche nach einem Leerzeichen: 1/2, 1/4 und 3/4 werden Unicode-Zeichen; andere N/D werden Inline-LaTeX. Höchstens 12 Ziffern je Teil; Nenner 0 bleibt unverändert.')}</p>
      <p>{t('Keine Ersetzung in Code, Mermaid, Formeln, Links, URLs, Dateipfaden oder verketteten Datumsangaben.')}</p>
    </section>
    <section className="space-y-1">
      <h4 className="font-semibold text-slate-800">{t('Mermaid')}</h4>
      <a href={mermaidDocumentationURL} target="_blank" rel="noopener noreferrer" title={t('Im Browser öffnen')}
        className="inline-block text-sky-700 underline focus-visible:outline focus-visible:outline-sky-500"
        onClick={event => {
          event.preventDefault();
          if (window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(mermaidDocumentationURL);
          else window.open(mermaidDocumentationURL, '_blank', 'noopener,noreferrer');
        }}>{t('Mermaid-Syntaxdokumentation')}</a>
      {MERMAID_TEMPLATES.map(({ labelKey, source }) => <MermaidExample key={labelKey} label={t(labelKey)} source={source} />)}
    </section>
  </div>;
}
