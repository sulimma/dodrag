import React, { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  ListTodo, Quote, Code, SquareCode, Workflow, Undo2, Redo2, Heading, ChevronDown,
} from 'lucide-react';
import { t, useLanguage } from '../../i18n';

export function DescriptionToolbar({ editor, onError }: { editor: Editor | null; onError(error: unknown): void }) {
  useLanguage();
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const headingDropdown = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headingsOpen) return;
    const dismiss = (event: PointerEvent) => { if (!headingDropdown.current?.contains(event.target as Node)) setHeadingsOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [headingsOpen]);
  // Snapshot the values rendered below, not a counter followed by reads from
  // the mutable editor during a potentially concurrent React render.
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'), strike: current.isActive('strike'),
    h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
    paragraph: current.isActive('paragraph'),
    bulletList: current.isActive('bulletList'), orderedList: current.isActive('orderedList'), taskList: current.isActive('taskList'),
    blockquote: current.isActive('blockquote'), code: current.isActive('code'),
    codeBlock: current.isActive('codeBlock') && !current.isActive('codeBlock', { language: 'mermaid' }),
    mermaid: current.isActive('codeBlock', { language: 'mermaid' }),
    undo: current.can().undo(), redo: current.can().redo(),
  } : null });
  if (!editor || !state) return null;
  const actions = [
    { label: t('Fett'), icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: t('Kursiv'), icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: t('Durchgestrichen'), icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: t('Aufzählung'), icon: List, active: state.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: t('Nummerierte Liste'), icon: ListOrdered, active: state.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: t('Checkliste ein-/ausschalten'), icon: ListTodo, active: state.taskList, run: () => editor.chain().focus().toggleTaskList().run() },
    { label: t('Zitat'), icon: Quote, active: state.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: t('Inline-Code'), icon: Code, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { label: t('Codeblock'), icon: SquareCode, active: state.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: t('Mermaid-Diagramm einfügen'), icon: Workflow, active: state.mermaid, run: () => editor.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A --> B' }] }).run() },
    { label: t('Rückgängig'), icon: Undo2, disabled: !state.undo, run: () => editor.chain().focus().undo().run() },
    { label: t('Wiederholen'), icon: Redo2, disabled: !state.redo, run: () => editor.chain().focus().redo().run() },
  ];
  const headings = [
    { label: t('Absatz'), icon: Heading, active: state.paragraph, run: () => editor.chain().focus().setParagraph().run() },
    { label: t('Überschrift 1'), icon: Heading1, active: state.h1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: t('Überschrift 2'), icon: Heading2, active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: t('Überschrift 3'), icon: Heading3, active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];
  return <div role="group" aria-label={t('Textformatierung')}
    className="relative z-10 flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-3 py-2"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeadingsOpen(false); }}>
    <div ref={headingDropdown} className="relative" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setHeadingsOpen(false); headingDropdown.current?.querySelector('button')?.focus(); }
    }}>
      <button type="button" title={t('Überschriften')} aria-label={t('Überschriften')} aria-expanded={headingsOpen}
        className="flex h-7 items-center gap-1 rounded px-1.5 text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-600"
        onMouseDown={event => event.preventDefault()} onClick={() => setHeadingsOpen(!headingsOpen)}>
        <Heading size={16} aria-hidden="true" /><span className="text-xs">{state.h1 ? t('Überschrift 1') : state.h2 ? t('Überschrift 2') : state.h3 ? t('Überschrift 3') : t('Absatz')}</span><ChevronDown size={12} aria-hidden="true" />
      </button>
      {headingsOpen && <div className="absolute left-0 top-full mt-1 min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
        {headings.map(({ label, icon: Icon, active, run }) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={active}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-sky-600 ${active ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
          onMouseDown={event => event.preventDefault()} onClick={() => { try { run(); setHeadingsOpen(false); } catch (error) { onError(error); } }}>
          <Icon size={16} aria-hidden="true" />{label}
        </button>)}
      </div>}
    </div>
    {actions.map(({ label, icon: Icon, active, disabled, run }, index) => <React.Fragment key={label}>
      {[0, 3, 6, 9].includes(index) && <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-slate-200" />}
      <button type="button"
      title={label} aria-label={label} aria-pressed={active} disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 disabled:opacity-30 ${active ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
      onMouseDown={event => event.preventDefault()} onClick={() => {
        try { run(); } catch (error) { onError(error); }
      }}><Icon size={16} aria-hidden="true" /></button></React.Fragment>)}
  </div>;
}
