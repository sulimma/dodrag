import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { t, useLanguage } from '../../i18n';

let mermaidModule: Promise<typeof import('mermaid')['default']> | undefined;
let diagramSequence = 0;
const diagramTitle = 'Mermaid:'; // Technical format name, identical in every language.
async function renderMermaid(source: string): Promise<string> {
  mermaidModule ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
    return mermaid;
  });
  const mermaid = await mermaidModule;
  const host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-100000px';
  document.body.append(host);
  try {
    const { svg } = await mermaid.render(`dodrag-mermaid-${++diagramSequence}`, source, host);
    return svg;
  } finally { host.remove(); }
}

export function MermaidBlockView({ node, editor, getPos, deleteNode, selected }: NodeViewProps) {
  useLanguage();
  const isMermaid = node.attrs.language === 'mermaid';
  const [editing, setEditing] = useState(false);
  const [svg, setSVG] = useState('');
  const [failure, setFailure] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const focusSource = useRef(false);
  useLayoutEffect(() => {
    if (!editing || !focusSource.current) return;
    focusSource.current = false;
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    // Focus only after React has exposed the actual ProseMirror content DOM.
    editor.commands.setTextSelection(pos + 1);
    editor.view.focus();
  }, [editing, editor, getPos]);
  useEffect(() => {
    if (!editing) return;
    const selectionChanged = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
      if (typeof pos !== 'number' || !current || from <= pos || to >= pos + current.nodeSize) setEditing(false);
    };
    const blurred = ({ event }: { event: FocusEvent }) => {
      if (!wrapper.current?.contains(event.relatedTarget as globalThis.Node | null)) setEditing(false);
    };
    const escape = (event: KeyboardEvent) => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      const current = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
      if (event.key !== 'Escape' || typeof pos !== 'number' || !current || from <= pos || to >= pos + current.nodeSize) return;
      event.preventDefault(); event.stopPropagation();
      setEditing(false); editor.commands.setNodeSelection(pos); editor.view.focus();
    };
    editor.on('selectionUpdate', selectionChanged);
    editor.on('blur', blurred);
    editor.view.dom.addEventListener('keydown', escape, true);
    return () => {
      editor.off('selectionUpdate', selectionChanged); editor.off('blur', blurred);
      editor.view.dom.removeEventListener('keydown', escape, true);
    };
  }, [editing, editor, getPos]);
  useEffect(() => {
    if (!isMermaid || editing) return;
    let active = true;
    setSVG(''); setFailure('');
    void renderMermaid(node.textContent).then(value => {
      if (active) setSVG(value);
    }).catch(error => {
      if (active) { setFailure(error instanceof Error ? error.message : String(error)); setEditing(true); }
    });
    return () => { active = false; };
  }, [isMermaid, node.textContent, editing]);
  if (!isMermaid) return <NodeViewWrapper as="pre"><NodeViewContent<'code'> as="code" /></NodeViewWrapper>;
  const edit = () => {
    focusSource.current = true;
    if (editing) {
      const pos = getPos();
      if (typeof pos === 'number' && !editor.isDestroyed) {
        editor.commands.setTextSelection(pos + 1); editor.view.focus();
      }
      focusSource.current = false;
    }
    setEditing(true);
  };
  const select = () => {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    editor.commands.setNodeSelection(pos); editor.view.focus();
  };
  const insertParagraph = (before: boolean) => {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    const boundary = before ? pos : pos + node.nodeSize;
    const adjacent = before ? editor.state.doc.resolve(boundary).nodeBefore : editor.state.doc.resolve(boundary).nodeAfter;
    const transaction = editor.state.tr;
    let cursor = boundary + 1;
    if (adjacent?.type === editor.schema.nodes.paragraph) cursor = before ? boundary - 1 : boundary + 1;
    else transaction.insert(boundary, editor.schema.nodes.paragraph.create());
    transaction.setSelection(TextSelection.create(transaction.doc, cursor));
    editor.view.dispatch(transaction.scrollIntoView()); editor.view.focus();
  };
  return <NodeViewWrapper ref={wrapper} data-mermaid-editing={editing || undefined} data-mermaid-block="true" data-mermaid-selected={selected || undefined}
    className="mermaid-block"
    onBlur={(event: React.FocusEvent) => {
      // The editable code inherits the shared root; focusing it blurs the button.
      if (event.relatedTarget === editor.view.dom) return;
      if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setEditing(false);
    }} onKeyDown={(event: React.KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setEditing(false); select(); }
    }}>
    <button type="button" contentEditable={false} className="mermaid-insert" data-mermaid-insert="before"
      aria-label={t('Absatz vor Mermaid-Diagramm einfügen')} title={t('Absatz vor Mermaid-Diagramm einfügen')}
      onMouseDown={event => event.preventDefault()} onClick={() => insertParagraph(true)} />
    <div className="mermaid-body rounded-lg border border-slate-200 bg-slate-50 p-2"
      onMouseDown={event => {
        if ((event.target as Element).closest('pre,button')) return;
        event.preventDefault(); select();
      }}
      onClick={event => {
        if ((event.target as Element).closest('pre,button')) return;
        select();
      }}
      onContextMenu={event => {
        if (!(event.target as Element).closest('pre,button')) select();
      }}>
      <div contentEditable={false}>
        <div className="flex items-center gap-1 text-xs text-slate-500" data-mermaid-title="true">
          <span>{diagramTitle}</span>
          <button type="button" title={t('Mermaid-Diagramm bearbeiten')} aria-label={t('Mermaid-Diagramm bearbeiten')}
            className="hover:text-sky-700" onClick={edit}>{t('bearbeiten')}</button>
          <span aria-hidden="true">|</span>
          <button type="button" title={t('Mermaid-Diagramm löschen')} aria-label={t('Mermaid-Diagramm löschen')}
            className="hover:text-red-700" onClick={() => {
            deleteNode(); if (!editor.isDestroyed) editor.view.focus();
          }}>{t('löschen')}</button>
        </div>
        {svg && <div role="img" aria-label={t('Mermaid-Vorschau')} className="overflow-auto [&_svg]:max-w-full"
          style={{ zoom: 0.75 }}
          onClick={select} onDoubleClick={edit} dangerouslySetInnerHTML={{ __html: svg }} />}
        {failure && <div role="alert" className="text-xs text-red-700 whitespace-pre-wrap">
          {t('Mermaid-Diagramm konnte nicht gerendert werden')}{': '}{failure}
        </div>}
      </div>
      <pre className={editing ? 'mt-2 whitespace-pre-wrap text-xs' : 'hidden'}>
        <NodeViewContent<'code'> as="code" aria-label={t('Mermaid-Quelltext')} />
      </pre>
    </div>
    <button type="button" contentEditable={false} className="mermaid-insert" data-mermaid-insert="after"
      aria-label={t('Absatz nach Mermaid-Diagramm einfügen')} title={t('Absatz nach Mermaid-Diagramm einfügen')}
      onMouseDown={event => event.preventDefault()} onClick={() => insertParagraph(false)} />
  </NodeViewWrapper>;
}
