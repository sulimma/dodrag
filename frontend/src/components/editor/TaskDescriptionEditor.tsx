import { sourceSymbol } from './SourceIcon';
import React, { forwardRef, useEffect, useLayoutEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
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
import { closeHistory } from '@tiptap/pm/history';
import { eventBridge } from '../../bridge/eventBridge';
import { t, useLanguage } from '../../i18n';
import { DiagramBlockView, placeDiagramCaret } from './DiagramBlockView';
import { isDiagramLanguage, renderDiagram } from './diagramRendering';
import { DescriptionToolbar } from './DescriptionToolbar';
import { PathAndUrlExtension, sourceAtElement } from './PathAndUrlExtension';
import { editTarget, insertLinkLabel, TargetEditing, targetEditLabel, targetAsLabel, useTargetAsLabel } from './TargetEditing';
import { LocalImage } from './LocalImage';
import { EMOTICON_SHAPE_VARIANTS, MarkdownFeatures, markdownFeaturesCSS } from './MarkdownFeatures';
import { hasMarkdownFormatting, isMarkdownPath, readMarkdownSources } from './markdownImport';
import { MarkdownTargets } from './MarkdownTargets';
import { SymbolReplacements } from './SymbolReplacements';
import { classifyTarget, nativeDropText, urlDropText, SOURCE_MIME, targetFromElement } from './targets';
import { openTarget, targetMenuItems } from './contextMenu';
import type { EditorContextMenuCallback, EditorTarget, TaskDescriptionEditorHandle } from './types';
export type { TaskDescriptionEditorHandle } from './types';

export interface TaskDescriptionEditorProps {
  taskId: string;
  active?: boolean;
  description: string;
  onChange(markdown: string): void;
  onCommit?(): void;
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
.dodrag-description a[href]{color:#0369a1;text-decoration:underline;cursor:text}.dodrag-description .dodrag-target-hidden{display:none}.dodrag-description .dodrag-target-input{max-width:100%;color:#6d28d9;background:#f5f3ff;border-radius:3px;outline:1px solid #8b5cf6;padding:0 3px;cursor:text}.dodrag-description .dodrag-target-input[aria-invalid=true]{outline-color:#b91c1c}
.dodrag-description .diagram-block{margin:0}.dodrag-description .diagram-insert{display:block;width:100%;height:8px;padding:0;cursor:text;border:0;background:transparent;position:relative}.dodrag-description .diagram-insert:hover:after,.dodrag-description .diagram-insert:focus-visible:after{content:"";position:absolute;left:0;right:0;top:3px;border-top:2px solid #0284c7}.dodrag-description [data-diagram-selected]>.diagram-body{outline:2px solid #0284c7}.dodrag-description .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}.dodrag-description .ProseMirror-gapcursor:after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:2px solid #0284c7;animation:dodrag-gapcursor 1s steps(2,start) infinite}.dodrag-description.ProseMirror-focused .ProseMirror-gapcursor{display:block}@keyframes dodrag-gapcursor{to{visibility:hidden}}`;

function isDiagram(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === 'codeBlock' && isDiagramLanguage(node.attrs.language);
}

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
  const loadedTask = useRef(props.taskId);
  const taskSession = useRef(0);
  const documentRevision = useRef(0);
  const liveEditor = useRef<Editor | null>(null);
  const routingPaste = useRef(false);
  const editor: Editor | null = useEditor({
    shouldRerenderOnTransaction: false,
    // The Markdown parser owns paste formatting. Regex paste rules would
    // reformat literal Shift+paste and text inside the chosen HTML afterwards.
    enablePasteRules: false,
    editable: props.active !== false,
    extensions: [StarterKit.configure({ code: false, codeBlock: false, link: false, trailingNode: false }), MarkdownTargets,
      // CommonMark permits formatted code spans, e.g. **`§ 3` (Definition):**.
      // The Markdown parser emits both marks; Code's default excludes all other
      // marks and makes these valid documents fail schema validation on import.
      Code.extend({ excludes: '' }),
      CodeBlock.extend({ addNodeView() { return ReactNodeViewRenderer(DiagramBlockView); } }),
      TaskList, MarkdownTaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' }, a11y: { checkboxLabel: () => t('Checkliste ein-/ausschalten') } }),
      MarkdownLink.configure({ openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['http', 'https', 'mailto', 'sip', 'tel'] }),
      LocalImage.configure({ getTaskId: () => callbacks.current.taskId }), Table, TableRow, TableHeader, TableCell,
      PathAndUrlExtension.configure({ getTaskId: () => callbacks.current.taskId }), TargetEditing,
      ...MarkdownFeatures,
      Markdown, SymbolReplacements],
    content: props.description,
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'dodrag-description min-h-full outline-none text-sm leading-relaxed text-slate-800 break-words', 'aria-label': t('Beschreibung'), autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off' },
      clipboardTextSerializer: slice => liveEditor.current ? markdownStorage(liveEditor.current).serializer.serialize(slice.content) : '',
      transformPastedHTML: html => {
        const container = document.createElement('div');
        container.innerHTML = html;
        // ponytail: Only direct trailing BRs in LI are normalized; nested text/code
        // and intentional empty paragraphs remain untouched, not guessed away.
        for (const item of container.querySelectorAll('li')) {
          for (const node of Array.from(item.childNodes).reverse()) {
            if (node.nodeType === globalThis.Node.COMMENT_NODE ||
              node.nodeType === globalThis.Node.TEXT_NODE && !node.textContent?.trim()) continue;
            if (!(node instanceof Element) || node.tagName !== 'BR') break;
            node.remove();
          }
        }
        return container.innerHTML;
      },
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
        paste: (view, event) => {
          if (routingPaste.current) return false;
          view.dispatch(closeHistory(view.state.tr));
          const data = event.clipboardData;
          const current = liveEditor.current;
          if (!data || !current) return false;
          const text = data.getData('text/plain');
          // Decide from the parsed plain-text document, not HTML wrappers or
          // VS Code's language metadata. The normal pipeline still owns code
          // destinations, Shift+paste, slice fitting, symbol rules and undo.
          const markdown = !!text && !view.state.selection.$from.parent.type.spec.code &&
            hasMarkdownFormatting(current.markdown!.parse(text));
          if (!markdown && !data.getData('vscode-editor-data')) return false;
          const hidden = new Set(['vscode-editor-data', ...(markdown ? ['text/html'] : [])]);
          const routed = new Event('paste', { cancelable: true });
          Object.defineProperty(routed, 'clipboardData', { value: {
            files: data.files, types: Array.from(data.types).filter(type => !hidden.has(type)),
            getData: (type: string) => hidden.has(type) ? '' : data.getData(type),
          } });
          // Tiptap otherwise turns every VS Code language (even Markdown)
          // into a code block after parsing. Filter that hint for all formats.
          event.preventDefault();
          routingPaste.current = true;
          try { view.dispatchEvent(routed); } finally { routingPaste.current = false; }
          return true;
        },
        drop: (view, event) => {
          if (event.dataTransfer?.types.includes(SOURCE_MIME)) { event.preventDefault(); return true; }
          const text = event.dataTransfer && urlDropText(event.dataTransfer);
          if (text) {
            // Own URI drops before Wails interprets virtual URL files as paths.
            event.preventDefault(); event.stopPropagation();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
            const tr = closeHistory(view.state.tr).insertText(text, pos);
            tr.setMeta('description:boundary', true);
            tr.setSelection(TextSelection.create(tr.doc, pos + text.length));
            view.dispatch(tr.scrollIntoView()); view.focus();
            return true;
          }
          if (!event.dataTransfer?.types.includes('Files')) return false;
          // Skip ProseMirror clipboard parsing; Wails resolves native file paths
          // in its window-level bubble listener, so propagation must continue.
          event.preventDefault(); return true;
        },
      },
      handleClick: (view, pos, event) => {
        if (!view.editable || event.button !== 0 || event.target !== view.dom) return false;
        const $pos = view.state.doc.resolve(pos);
        let diagram: ProseMirrorNode, start: number;
        if (isDiagram($pos.parent)) { diagram = $pos.parent; start = $pos.before(); }
        else if (isDiagram($pos.nodeBefore)) { diagram = $pos.nodeBefore; start = $pos.pos - diagram.nodeSize; }
        else if (isDiagram($pos.nodeAfter)) { diagram = $pos.nodeAfter; start = $pos.pos; }
        else return false;
        const dom = view.nodeDOM(start);
        const block = dom instanceof Element ? dom.querySelector('[data-diagram-block]') : null;
        if (!block || block.hasAttribute('data-diagram-editing')) return false;
        // A click in the editor's trailing whitespace can resolve into hidden code.
        const before = event.clientY < block.getBoundingClientRect().top;
        return placeDiagramCaret(view, before ? start : start + diagram.nodeSize, before);
      },
      handleKeyDown: (view, event) => {
        const { selection, doc } = view.state;
        if (selection instanceof NodeSelection && isDiagram(selection.node) &&
            !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1
            : ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : 0;
          if (direction) {
            const $boundary = doc.resolve(direction < 0 ? selection.from : selection.to);
            const adjacent = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
            if (adjacent?.isTextblock && !isDiagram(adjacent)) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, $boundary.pos + direction)).scrollIntoView());
              return true;
            }
            return placeDiagramCaret(view, $boundary.pos, direction < 0);
          }
        }
        if (event.key !== 'Escape') return false;
        if (event.target instanceof Element && event.target.closest('[data-diagram-editing]')) return false;
        event.preventDefault(); callbacks.current.onCommit?.(); view.dom.blur(); callbacks.current.onEscape(); return true;
      },
    },
    onTransaction: ({ transaction }) => { if (transaction.docChanged) documentRevision.current++; },
    onUpdate: ({ editor, transaction }) => {
      const markdown = markdownStorage(editor).getMarkdown();
      const historyBoundary = transaction.getMeta('description:boundary') === true || transaction.getMeta('uiEvent') === 'paste';
      // Changes update the App-owned draft only. Local history never writes SQLite.
      try { callbacks.current.onChange(markdown); } catch (error) { callbacks.current.onError(error); }
      if (historyBoundary) editor.view.dispatch(closeHistory(editor.state.tr));
    },
  }, []);
  liveEditor.current = editor;
  // Keep local history/selection across compact mode, but only the visible editor edits.
  useLayoutEffect(() => { editor?.setEditable(props.active !== false, false); }, [editor, props.active]);
  useEffect(() => {
    editor?.view.dom.setAttribute('aria-label', t('Beschreibung'));
    editor?.view.dispatch(editor.state.tr.setMeta('addToHistory', false).setMeta('source:refresh', true));
  }, [editor, language]);
  useLayoutEffect(() => {
    if (!editor) return;
    if (loadedTask.current !== props.taskId) {
      loadedTask.current = props.taskId;
      taskSession.current++;
      editor.commands.setContent(props.description, { emitUpdate: false, contentType: 'markdown' });
      // Reinitialize plugin state, especially local undo, without recreating the editor.
      editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
      return;
    }
    if (props.description !== markdownStorage(editor).getMarkdown()) editor.commands.setContent(props.description, { emitUpdate: false, contentType: 'markdown' });
  }, [editor, props.taskId, props.description]);
  useImperativeHandle(ref, () => ({
    focus: () => { editor?.view.focus(); },
    insertFiles(paths, x, y) {
      if (!editor || callbacks.current.active === false || !paths.length) return;
      const text = nativeDropText(paths); // Validate mixed drops before any asynchronous read.
      if (paths.some(value => classifyTarget(value)?.kind === 'path' && isMarkdownPath(value))) {
        const session = taskSession.current;
        return readMarkdownSources(paths.map(value => classifyTarget(value)!)).then(additions => {
          if (editor.isDestroyed || session !== taskSession.current || callbacks.current.active === false) return;
          // Append to the live document after reading; typing during I/O survives.
          const nodes = additions.flatMap(item => editor.markdown!.parse(item.kind === 'markdown' ? item.value : nativeDropText([item.value])).content ?? []);
          if (!nodes.length) return;
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.chain().insertContentAt(editor.state.doc.content.size, nodes).setMeta('description:boundary', true).run();
          editor.view.focus();
        }).catch(error => callbacks.current.onError(error));
      }
      const pos = x === undefined || y === undefined ? undefined : editor.view.posAtCoords({ left: x, top: y })?.pos;
      const start = pos ?? editor.state.selection.from;
      const transaction = closeHistory(editor.state.tr).insertText(text, start, start);
      transaction.setSelection(TextSelection.create(transaction.doc, start + text.length));
      transaction.setMeta('description:boundary', true);
      editor.view.dispatch(transaction.scrollIntoView());
      // Wails calls this imperatively, outside React rendering. Tiptap's
      // commands.focus() defers focus to RAF and lets immediate Ctrl+Z escape.
      editor.view.focus();
    },
  }), [editor]);
  const contextMenu = (event: React.MouseEvent<HTMLDivElement>, captureOnly = false) => {
    if (!editor) return;
    if (event.target instanceof Element && event.target.closest('.dodrag-target-input')) {
      if (!captureOnly) event.stopPropagation();
      return;
    }
    const target = targetFromElement(event.target);
    const range = !captureOnly && target ? sourceAtElement(editor.view, event.target, target) : undefined;
    const session = taskSession.current;
    const taskId = props.taskId;
    const revision = documentRevision.current;
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    const diagramCode = event.target instanceof Element
      ? event.target.closest('[data-diagram-block]')?.querySelector('code') : null;
    const diagram = diagramCode
      ? doc.resolve(editor.view.posAtDOM(diagramCode, 0)).parent
      : event.target === editor.view.dom && selection instanceof NodeSelection ? selection.node : null;
    const diagramLanguage: unknown = diagram?.type.name === 'codeBlock' ? diagram.attrs.language : null;
    const emoticon = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-emoticon]') : null;
    const shapes: { pos: number; node: ProseMirrorNode; variants: typeof EMOTICON_SHAPE_VARIANTS.star }[] = [];
    const addShape = (node: ProseMirrorNode | null, pos: number) => {
      if (node?.type.name !== 'emoticon') return;
      const variants = Object.values(EMOTICON_SHAPE_VARIANTS).find(items =>
        items.some(item => item.shortcut === node.attrs.shortcut) || node.attrs.shortcut === '(*y)' && items === EMOTICON_SHAPE_VARIANTS.star);
      if (variants) shapes.push({ pos, node, variants });
    };
    if (event.target instanceof globalThis.Node && editor.view.dom.contains(event.target)) {
      if (!selection.empty) doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (pos >= selection.from && pos + node.nodeSize <= selection.to) addShape(node, pos);
      });
      if (!shapes.length && emoticon?.parentNode) {
        // Map the boundary before the atom, not its non-editable glyph content.
        const offset = Array.prototype.indexOf.call(emoticon.parentNode.childNodes, emoticon);
        const pos = editor.view.posAtDOM(emoticon.parentNode, offset);
        addShape(doc.nodeAt(pos), pos);
      } else if (!shapes.length && selection.empty && !emoticon && !target) {
        addShape(selection.$from.nodeAfter, selection.from);
        if (!shapes.length) addShape(selection.$from.nodeBefore, selection.from - (selection.$from.nodeBefore?.nodeSize ?? 0));
      }
    }
    // Capture only color menus; other NodeViews retain their own selection handlers.
    if (captureOnly && !shapes.length) return;
    event.preventDefault(); event.stopPropagation();
    const clipboardAction = async (action: string) => {
      if (shapes.length && action.startsWith('emoticon:color:')) {
        if (revision !== documentRevision.current || editor.state.doc !== doc) return;
        const index = EMOTICON_SHAPE_VARIANTS.star.findIndex((_, index) => action === `emoticon:color:${index}`);
        if (index < 0) return;
        const transaction = closeHistory(editor.state.tr);
        for (const { pos, node, variants } of shapes) {
          const shortcut = variants[index].shortcut;
          if (node.attrs.shortcut !== shortcut && !(node.attrs.shortcut === '(*y)' && shortcut === '(*)')) {
            transaction.setNodeMarkup(pos, undefined, { ...node.attrs, shortcut }, node.marks);
          }
        }
        if (transaction.docChanged) {
          editor.view.dispatch(transaction.setMeta('description:boundary', true));
          editor.view.focus();
        }
        return;
      }
      if (diagram && ['diagram:edit', 'diagram:delete'].includes(action)) {
        if (revision !== documentRevision.current || editor.state.doc !== doc || callbacks.current.active === false) return;
        const pos = diagramCode ? doc.resolve(editor.view.posAtDOM(diagramCode, 0)).before() : selection.from;
        const host = diagramCode?.closest('[data-diagram-block]') ??
          (editor.view.nodeDOM(pos) as Element | null)?.querySelector('[data-diagram-block]');
        if (action === 'diagram:edit') host?.dispatchEvent(new Event('diagram:edit'));
        else editor.chain().focus().deleteRange({ from: pos, to: pos + diagram.nodeSize }).run();
        return;
      }
      if (action === 'diagram:save-svg' && diagram && isDiagramLanguage(diagramLanguage)) {
        if (revision !== documentRevision.current || editor.state.doc !== doc) return;
        const svg = await renderDiagram(diagramLanguage, diagram.textContent);
        if (!editor.isDestroyed && callbacks.current.active !== false && session === taskSession.current &&
            revision === documentRevision.current) await eventBridge.saveDiagramSVG(typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg));
        return;
      }
      if (range && ['source:edit', 'source:insert-label', 'source:use-as-label'].includes(action)) {
        if (revision !== documentRevision.current || editor.state.doc !== doc || callbacks.current.active === false) return;
        if (action === 'source:edit') editTarget(editor.view, range);
        else if (action === 'source:insert-label') insertLinkLabel(editor.view, range);
        else useTargetAsLabel(editor.view, range);
        return;
      }
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
        if (action === 'editor:cut' && !editor.isDestroyed && session === taskSession.current && callbacks.current.active !== false) editor.chain().focus().deleteRange({ from, to }).run();
      } else if (action === 'editor:paste') {
        const formats = new Map<string, string>();
        if (navigator.clipboard.read) {
          const clipboard = await navigator.clipboard.read();
          for (const type of ['text/html', 'text/plain']) {
            const item = clipboard.find(item => item.types.includes(type));
            if (item) formats.set(type, await (await item.getType(type)).text());
          }
        } else formats.set('text/plain', await navigator.clipboard.readText());
        if (formats.size && !editor.isDestroyed && session === taskSession.current && callbacks.current.active !== false) {
          // Dispatch directly to ProseMirror, not an OS paste. Its public pasteText
          // forces plain-text mode; this adapter preserves both formats and the
          // same Markdown, code-context, normalization and undo rules as Ctrl+V.
          const event = new Event('paste', { cancelable: true });
          Object.defineProperty(event, 'clipboardData', { value: {
            types: [...formats.keys()], files: [], getData: (type: string) => formats.get(type) ?? '',
          } });
          editor.view.dispatchEvent(event);
          editor.view.focus();
        }
      }
    };
    const items = shapes.length ? shapes[0].variants.map((item, index) => ({ id: `emoticon:color:${index}`,
      label: `${item.emoji} ${t(item.labelKey)}`, disabled: shapes.every(({ node, variants }) =>
        node.attrs.shortcut === variants[index].shortcut || node.attrs.shortcut === '(*y)' && variants[index].shortcut === '(*)') }))
      : target ? targetMenuItems(target, !!props.onCreateSourceTask) : [{ id: 'editor:cut', label: t('Ausschneiden'), shortcut: 'Ctrl+X', disabled: editor.state.selection.empty },
      { id: 'editor:copy', label: t('Kopieren'), shortcut: 'Ctrl+C', disabled: editor.state.selection.empty },
      { id: 'editor:paste', label: t('Einfügen'), shortcut: 'Ctrl+V', disabled: false }];
    if (target && !shapes.length) {
      const widget = [...editor.view.dom.querySelectorAll<HTMLElement>('[data-source-drag]')].find(node =>
        node.dataset.targetValue === target.value && node.dataset.targetKind === target.kind);
      const symbol = widget?.textContent || sourceSymbol(target);
      items.unshift({ id: 'source:destination', label: symbol + ' ' + target.value, disabled: true });
      if (range && props.active !== false) {
        if (range.mark || range.image) items.push({ id: 'source:edit', label: targetEditLabel(target), disabled: false });
        if (!range.image) items.push(range.mark
          ? { id: 'source:use-as-label', label: targetAsLabel(range), disabled: false }
          : { id: 'source:insert-label', label: t('Linktext einfügen'), disabled: false });
      }
    }
    if (isDiagramLanguage(diagramLanguage)) items.push(
      { id: 'diagram:edit', label: t('bearbeiten'), disabled: props.active === false },
      { id: 'diagram:delete', label: t('löschen'), disabled: props.active === false },
      { id: 'diagram:save-svg', label: t('SVG speichern'), disabled: false });
    props.onContextMenu(event, { target, items, execute: async action => {
      if (editor.isDestroyed || session !== taskSession.current || taskId !== callbacks.current.taskId || !items.some(item => item.id === action && !item.disabled)) return;
      try { await clipboardAction(action); } catch (error) { callbacks.current.onError(error); }
    } });
  };
  const copySelectedDiagram = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!editor || event.target instanceof Element && event.target.closest('input,textarea')) return;
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'codeBlock' || !isDiagramLanguage(selection.node.attrs.language)) return;
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
    onBlur={event => {
      // Native popups temporarily report no relatedTarget: they are still part
      // of this session. Toolbar and portalled history controls are too.
      const next = event.relatedTarget as Node | null;
      if (next && !event.currentTarget.contains(next) && !props.historyTarget?.contains(next)) props.onCommit?.();
    }}
    onContextMenuCapture={event => contextMenu(event, true)} onContextMenu={event => contextMenu(event)}
    onClick={event => { if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault(); }}
    onAuxClick={event => { if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault(); }}>
    <style>{editorCSS + markdownFeaturesCSS}</style>
    <DescriptionToolbar editor={editor} onError={props.onError} historyTarget={props.historyTarget} />
    <EditorContent editor={editor} className="flex-1 min-h-0 overflow-y-auto p-3" />
  </div>;
});
