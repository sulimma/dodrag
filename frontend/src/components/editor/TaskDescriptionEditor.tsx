import React, { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { MarkdownLink } from './MarkdownLink';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlock from '@tiptap/extension-code-block';
import { Markdown } from '@tiptap/markdown';
import { InputRule } from '@tiptap/core';
import { DOMParser, DOMSerializer, Slice, type Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import { t, useLanguage } from '../../i18n';
import { MermaidBlockView } from './MermaidBlockView';
import { DescriptionToolbar } from './DescriptionToolbar';
import { PathAndUrlExtension } from './PathAndUrlExtension';
import { LocalImage } from './LocalImage';
import { MarkdownFeatures, markdownFeaturesCSS } from './MarkdownFeatures';
import { MarkdownTargets } from './MarkdownTargets';
import { SymbolReplacements } from './SymbolReplacements';
import { fileDropText, SOURCE_MIME, targetFromElement } from './targets';
import { openTarget, targetMenuItems } from './contextMenu';
import type { EditorContextMenuCallback, EditorTarget, TaskDescriptionEditorHandle } from './types';
export type { TaskDescriptionEditorHandle } from './types';

export interface DescriptionChangeMetadata { historyBoundary?: boolean; localUndo?: boolean }

export interface TaskDescriptionEditorProps {
  taskId: string;
  description: string;
  onChange(markdown: string, metadata?: DescriptionChangeMetadata): void;
  onEscape(): void;
  onContextMenu: EditorContextMenuCallback;
  onError(error: unknown): void;
  onCreateSourceTask?(target: EditorTarget): void | Promise<void>;
  historyTarget?: HTMLElement | null;
}

export function markdownStorage(editor: Editor): {
  getMarkdown(): string;
  serializer: { serialize(node: ProseMirrorNode | Fragment): string };
} { return { getMarkdown: () => editor.getMarkdown(), serializer: { serialize(node) {
  const json = node.toJSON();
  return editor.markdown!.serialize(Array.isArray(json) || json === null ? { type: 'doc', content: json ?? [] } : json);
} } }; }

const editorCSS = `.dodrag-description p{margin:.4em 0}.dodrag-description h1{font-size:1.5em;font-weight:700}.dodrag-description h2{font-size:1.25em;font-weight:700}.dodrag-description h3{font-weight:700}.dodrag-description ul{list-style:disc;padding-left:1.4em}.dodrag-description ol{list-style:decimal;padding-left:1.4em}.dodrag-description ul[data-type=taskList]{list-style:none;padding-left:0}.dodrag-description li[data-type=taskItem]{display:flex;gap:.5em;align-items:baseline}.dodrag-description li[data-type=taskItem]>label{display:inline-flex;align-items:center;flex:0 0 auto;margin:0;padding:0}.dodrag-description li[data-type=taskItem]>label>span{display:inline-block}.dodrag-description li[data-type=taskItem]>div{flex:1;min-width:0}.dodrag-description li[data-type=taskItem]>div>p{margin:0}.dodrag-description blockquote{border-left:3px solid #cbd5e1;padding-left:.75em}.dodrag-description pre{padding:.5em;background:#f1f5f9;border-radius:.4em;white-space:pre-wrap}.dodrag-description code{font-family:monospace}.dodrag-description table{border-collapse:collapse;width:100%}.dodrag-description td,.dodrag-description th{border:1px solid #cbd5e1;padding:.35em}.dodrag-description th{background:#f1f5f9}
.dodrag-description .mermaid-block{margin:0}.dodrag-description .mermaid-insert{display:block;width:100%;height:8px;padding:0;cursor:text;border:0;background:transparent;position:relative}.dodrag-description .mermaid-insert:hover:after,.dodrag-description .mermaid-insert:focus-visible:after{content:"";position:absolute;left:0;right:0;top:3px;border-top:2px solid #0284c7}.dodrag-description [data-mermaid-selected]>.mermaid-body{outline:2px solid #0284c7}.dodrag-description .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}.dodrag-description .ProseMirror-gapcursor:after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:2px solid #0284c7;animation:dodrag-gapcursor 1s steps(2,start) infinite}.dodrag-description.ProseMirror-focused .ProseMirror-gapcursor{display:block}@keyframes dodrag-gapcursor{to{visibility:hidden}}`;

const MarkdownTaskItem = TaskItem.extend({
  addInputRules() {
    return [new InputRule({
      find: /^\s*(?:[-+*]\s)?\[([ xX])\]\s$/,
      handler: ({ range, match, chain }) => {
        // The bullet rule may already have consumed "- "; convert that list,
        // rather than nesting a checklist inside its existing list item.
        const commands = chain().deleteRange(range);
        if (!this.editor.isActive('taskList')) commands.toggleTaskList();
        commands.updateAttributes(this.name, { checked: match[1].toLowerCase() === 'x' }).run();
      },
    })];
  },
});

export const TaskDescriptionEditor = forwardRef<TaskDescriptionEditorHandle, TaskDescriptionEditorProps>(function TaskDescriptionEditor(props, ref) {
  const language = useLanguage();
  const callbacks = useRef(props); callbacks.current = props;
  const acknowledgements = useRef<string[]>([]);
  const loadedTask = useRef(props.taskId);
  const taskSession = useRef(0);
  const liveEditor = useRef<Editor | null>(null);
  const editor: Editor | null = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [StarterKit.configure({ codeBlock: false, link: false, trailingNode: false }), MarkdownTargets,
      CodeBlock.extend({ addNodeView() { return ReactNodeViewRenderer(MermaidBlockView); } }),
      TaskList, MarkdownTaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' }, a11y: { checkboxLabel: () => t('Checkliste ein-/ausschalten') } }),
      MarkdownLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['http', 'https', 'mailto', 'sip', 'tel'] }),
      LocalImage.configure({ getTaskId: () => callbacks.current.taskId }), Table, TableRow, TableHeader, TableCell,
      PathAndUrlExtension.configure({ getTaskId: () => callbacks.current.taskId }),
      ...MarkdownFeatures,
      Markdown, SymbolReplacements],
    content: props.description,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'dodrag-description min-h-full outline-none text-sm leading-relaxed text-slate-800 break-words', 'aria-label': t('Beschreibung'), autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off' },
      clipboardTextSerializer: slice => liveEditor.current ? markdownStorage(liveEditor.current).serializer.serialize(slice.content) : '',
      clipboardTextParser: (text, context, plain, view) => {
        const editor = liveEditor.current;
        if (!editor || plain || context.parent.type.spec.code) return null!;
        const content = editor.markdown!.parse(text);
        const container = document.createElement('div');
        container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.schema.nodeFromJSON(content).content));
        return DOMParser.fromSchema(editor.schema).parseSlice(container, { context, preserveWhitespace: true });
      },
      transformPasted: (slice, _view, plain) => {
        // Markdown's parseSlice opens fenced code blocks; fitting that slice
        // into a paragraph would discard the block and its language attribute.
        return slice.content.childCount === 1 && ['alert', 'blockMath', 'codeBlock'].includes(slice.content.firstChild?.type.name ?? '')
          ? new Slice(slice.content, 0, 0) : slice;
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          // Chromium normally runs rules after observing its DOM mutation. Run
          // matching rules before that mutation, but never interrupt an IME.
          const input = event as InputEvent;
          if (!input.cancelable || input.inputType !== 'insertText' || !input.data || input.isComposing || view.composing) return false;
          const ranges = input.getTargetRanges?.();
          const range = ranges?.[0];
          if (range && (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer))) return false;
          const from = range ? view.posAtDOM(range.startContainer, range.startOffset) : view.state.selection.from;
          const to = range ? view.posAtDOM(range.endContainer, range.endOffset) : view.state.selection.to;
          const handled = view.someProp('handleTextInput', handler => handler(view, from, to, input.data!, () => view.state.tr.insertText(input.data!, from, to)));
          if (handled) input.preventDefault();
          return !!handled;
        },
        paste: view => { view.dispatch(closeHistory(view.state.tr)); return false; },
        drop: (_, event) => {
          if (event.dataTransfer?.types.includes(SOURCE_MIME)) { event.preventDefault(); return true; }
          if (!event.dataTransfer?.types.includes('Files')) return false;
          // Skip ProseMirror clipboard parsing; Wails resolves native file paths
          // in its window-level bubble listener, so propagation must continue.
          event.preventDefault(); return true;
        },
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape') return false;
        if (event.target instanceof Element && event.target.closest('[data-mermaid-editing]')) return false;
        event.preventDefault(); view.dom.blur(); callbacks.current.onEscape(); return true;
      },
    },
    onUpdate: ({ editor, transaction }) => {
      const markdown = markdownStorage(editor).getMarkdown();
      acknowledgements.current.push(markdown);
      const historyBoundary = transaction.getMeta('description:boundary') === true || transaction.getMeta('uiEvent') === 'paste';
      const localUndo = isHistoryTransaction(transaction);
      try { callbacks.current.onChange(markdown, { historyBoundary, localUndo }); } catch (error) { callbacks.current.onError(error); }
      if (historyBoundary) editor.view.dispatch(closeHistory(editor.state.tr));
    },
  }, []);
  liveEditor.current = editor;
  useEffect(() => {
    editor?.view.dom.setAttribute('aria-label', t('Beschreibung'));
    editor?.view.dispatch(editor.state.tr.setMeta('addToHistory', false).setMeta('source:refresh', true));
  }, [editor, language]);
  useLayoutEffect(() => {
    if (!editor) return;
    if (loadedTask.current !== props.taskId) {
      loadedTask.current = props.taskId;
      taskSession.current++;
      acknowledgements.current = [];
      editor.commands.setContent(props.description, { emitUpdate: false, contentType: 'markdown' });
      // Reinitialize plugin state, especially local undo, without recreating the editor.
      editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
      return;
    }
    const acknowledgement = acknowledgements.current.lastIndexOf(props.description);
    if (acknowledgement !== -1) { acknowledgements.current.splice(0, acknowledgement + 1); return; }
    if (props.description !== markdownStorage(editor).getMarkdown()) editor.commands.setContent(props.description, { emitUpdate: false, contentType: 'markdown' });
  }, [editor, props.taskId, props.description]);
  useImperativeHandle(ref, () => ({
    focus: () => { editor?.view.focus(); },
    insertFiles(paths, x, y) {
      if (!editor || !paths.length) return;
      const pos = x === undefined || y === undefined ? undefined : editor.view.posAtCoords({ left: x, top: y })?.pos;
      const start = pos ?? editor.state.selection.from;
      const text = fileDropText(paths);
      const transaction = closeHistory(editor.state.tr).insertText(text, start, start);
      transaction.setSelection(TextSelection.create(transaction.doc, start + text.length));
      transaction.setMeta('description:boundary', true);
      editor.view.dispatch(transaction.scrollIntoView());
      // Wails calls this imperatively, outside React rendering. Tiptap's
      // commands.focus() defers focus to RAF and lets immediate Ctrl+Z escape.
      editor.view.focus();
    },
  }), [editor]);
  const contextMenu: React.MouseEventHandler<HTMLDivElement> = event => {
    event.preventDefault(); event.stopPropagation();
    if (!editor) return;
    const target = targetFromElement(event.target);
    const session = taskSession.current;
    const clipboardAction = async (action: string) => {
      if (target && action === 'source:create') { await callbacks.current.onCreateSourceTask?.(target); return; }
      if (target && ['url:open', 'path:explorer', 'path:vscode'].includes(action)) { await openTarget(target, action); return; }
      const { from, to } = editor.state.selection;
      if (action === 'editor:copy' || action === 'editor:cut') {
        const slice = editor.state.doc.slice(from, to);
        const text = markdownStorage(editor).serializer.serialize(slice.content);
        const container = document.createElement('div');
        container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
        const html = container.innerHTML;
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
        } else await navigator.clipboard.writeText(text);
        if (action === 'editor:cut' && !editor.isDestroyed && session === taskSession.current) editor.chain().focus().deleteRange({ from, to }).run();
      } else if (action === 'editor:paste') {
        let content: string | undefined;
        let contentType: 'html' | 'markdown' = 'markdown';
        if (navigator.clipboard.read) {
          const clipboard = await navigator.clipboard.read();
          const rich = clipboard.find(item => item.types.includes('text/html'));
          if (rich) { content = await (await rich.getType('text/html')).text(); contentType = 'html'; }
          else {
            const plain = clipboard.find(item => item.types.includes('text/plain'));
            if (plain) content = await (await plain.getType('text/plain')).text();
          }
        } else content = await navigator.clipboard.readText();
        if (content !== undefined && !editor.isDestroyed && session === taskSession.current) {
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.chain().insertContent(content, { contentType }).command(({ tr }) => { tr.setMeta('description:boundary', true); return true; }).run();
          editor.view.focus();
        }
      }
    };
    const items = target ? targetMenuItems(target, !!props.onCreateSourceTask) : [{ id: 'editor:cut', label: t('Ausschneiden'), shortcut: 'Ctrl+X', disabled: editor.state.selection.empty },
      { id: 'editor:copy', label: t('Kopieren'), shortcut: 'Ctrl+C', disabled: editor.state.selection.empty },
      { id: 'editor:paste', label: t('Einfügen'), shortcut: 'Ctrl+V', disabled: false }];
    props.onContextMenu(event, { target, items, execute: async action => {
      if (editor.isDestroyed || session !== taskSession.current || !items.some(item => item.id === action && !item.disabled)) return;
      try { await clipboardAction(action); } catch (error) { callbacks.current.onError(error); }
    } });
  };
  const copySelectedDiagram = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!editor || event.target instanceof Element && event.target.closest('input,textarea')) return;
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'codeBlock' || selection.node.attrs.language !== 'mermaid') return;
    // Native copy may target a NodeView button and bypass ProseMirror's handler.
    // Serialize the model selection, never the preview DOM or its controls.
    try {
      const { dom, text } = editor.view.serializeForClipboard(selection.content());
      event.clipboardData.clearData();
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', dom.innerHTML);
      event.preventDefault(); event.stopPropagation();
      if (event.type === 'cut') editor.view.dispatch(closeHistory(editor.state.tr).deleteSelection().setMeta('description:boundary', true));
    } catch (error) { props.onError(error); }
  };
  return <div data-task-selectable-text="true" data-description-editor="true" className="flex flex-1 flex-col min-h-0 overflow-hidden"
    onCopyCapture={copySelectedDiagram} onCutCapture={copySelectedDiagram}
    onContextMenu={contextMenu} onClick={event => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault();
      const target = targetFromElement(event.target);
      if (target) { event.preventDefault(); event.stopPropagation(); void openTarget(target).catch(props.onError); }
    }}>
    <style>{editorCSS + markdownFeaturesCSS}</style>
    <DescriptionToolbar editor={editor} onError={props.onError} historyTarget={props.historyTarget} />
    <EditorContent editor={editor} className="flex-1 min-h-0 overflow-y-auto p-3" />
  </div>;
});
