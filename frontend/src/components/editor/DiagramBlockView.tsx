import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t, useLanguage } from '../../i18n';
import { isDiagramLanguage, renderDiagram } from './diagramRendering';

// Opening newly inserted source is UI state only, never a persisted node attribute.
export const diagramsToEdit = new WeakSet<object>();

export function placeDiagramCaret(view: EditorView, boundary: number, before: boolean) {
  const $boundary = view.state.doc.resolve(boundary);
  const adjacent = before ? $boundary.nodeBefore : $boundary.nodeAfter;
  const paragraph = view.state.schema.nodes.paragraph;
  const tr = view.state.tr;
  let cursor = boundary + 1;
  if (adjacent?.type === paragraph) cursor = before ? boundary - 1 : boundary + 1;
  else if ($boundary.parent.canReplaceWith($boundary.index(), $boundary.index(), paragraph)) tr.insert(boundary, paragraph.create());
  else return false;
  tr.setSelection(TextSelection.create(tr.doc, cursor));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function DiagramBlockView({ node, editor, getPos, selected }: NodeViewProps) {
  useLanguage();
  const language: unknown = node.attrs.language;
  const isMermaid = language === 'mermaid';
  const [editing, setEditing] = useState(() => diagramsToEdit.has(node));
  const [svg, setSVG] = useState<string | SVGSVGElement>('');
  const [failure, setFailure] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const focusSource = useRef(diagramsToEdit.has(node));
  useLayoutEffect(() => {
    if (!editing || !focusSource.current) return;
    focusSource.current = false;
    diagramsToEdit.delete(node);
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed) return;
    // Focus only after React has exposed the actual ProseMirror content DOM.
    editor.commands.setTextSelection(pos + 1);
    editor.view.focus();
  }, [editing, editor, getPos, node]);
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
  }, [editing, editor, getPos, node]);
  useEffect(() => {
    if (!isDiagramLanguage(language) || editing) return;
    let active = true;
    setSVG(''); setFailure('');
    void renderDiagram(language, node.textContent).then(value => {
      if (active) setSVG(value);
    }).catch(error => {
      if (active) { setFailure(error instanceof Error ? error.message : String(error)); setEditing(true); }
    });
    return () => { active = false; };
  }, [language, node.textContent, editing]);
  useEffect(() => {
    const element = wrapper.current;
    const startEditing = () => { focusSource.current = true; setEditing(true); };
    element?.addEventListener('diagram:edit', startEditing);
    return () => element?.removeEventListener('diagram:edit', startEditing);
  });
  if (!isDiagramLanguage(language)) return <NodeViewWrapper as="pre"><NodeViewContent<'code'> as="code" /></NodeViewWrapper>;
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
    placeDiagramCaret(editor.view, before ? pos : pos + node.nodeSize, before);
  };
  return <NodeViewWrapper ref={wrapper} data-diagram-editing={editing || undefined} data-diagram-block="true" data-diagram-selected={selected || undefined}
    className="diagram-block"
    onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => {
      // The width beside a compact preview belongs to the surrounding editor text.
      if (event.target !== event.currentTarget || event.button !== 0 || editing || !editor.isEditable) return;
      event.preventDefault();
      insertParagraph(false);
    }}
    onBlur={(event: React.FocusEvent) => {
      // The editable code inherits the shared root; focusing it blurs the button.
      if (event.relatedTarget === editor.view.dom) return;
      if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setEditing(false);
    }} onKeyDown={(event: React.KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setEditing(false); select(); }
    }}>
    <button type="button" contentEditable={false} className="diagram-insert" data-diagram-insert="before"
      aria-label={(isMermaid ? t('Absatz vor Mermaid-Diagramm einfügen') : t('Absatz vor Diagramm einfügen'))} title={(isMermaid ? t('Absatz vor Mermaid-Diagramm einfügen') : t('Absatz vor Diagramm einfügen'))}
      onMouseDown={event => event.preventDefault()} onClick={() => insertParagraph(true)} />
    <div className={`diagram-body rounded-lg border border-slate-200 bg-slate-50 p-2${isMermaid ? '' : ' w-fit max-w-full'}`}
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
        {svg && <div role="img" aria-label={isMermaid ? t('Mermaid-Vorschau') : t('SMILES-Strukturformeln')}
          className={isMermaid ? 'overflow-auto [&_svg]:max-w-full' : 'overflow-x-auto'}
          style={isMermaid ? { zoom: 0.75 } : undefined}
          onClick={select} onDoubleClick={edit}>
          {typeof svg === 'string'
            ? <div dangerouslySetInnerHTML={{ __html: svg }} />
            : <div ref={host => { host?.replaceChildren(svg); }} />}
        </div>}
        {failure && <div role="alert" className="text-xs text-red-700 whitespace-pre-wrap">
          {(isMermaid ? t('Mermaid-Diagramm konnte nicht gerendert werden') : t('Diagramm konnte nicht gerendert werden'))}{': '}{failure}
        </div>}
      </div>
      <pre className={editing ? 'mt-2 whitespace-pre-wrap text-xs' : 'hidden'}>
        <NodeViewContent<'code'> as="code" aria-label={(isMermaid ? t('Mermaid-Quelltext') : t('Diagrammquelltext'))} />
      </pre>
    </div>
    <button type="button" contentEditable={false} className="diagram-insert" data-diagram-insert="after"
      aria-label={(isMermaid ? t('Absatz nach Mermaid-Diagramm einfügen') : t('Absatz nach Diagramm einfügen'))} title={(isMermaid ? t('Absatz nach Mermaid-Diagramm einfügen') : t('Absatz nach Diagramm einfügen'))}
      onMouseDown={event => event.preventDefault()} onClick={() => insertParagraph(false)} />
  </NodeViewWrapper>;
}
