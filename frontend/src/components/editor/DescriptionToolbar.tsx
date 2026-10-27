import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState, type Editor } from '@tiptap/react';
import { Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  ListTodo, Quote, Code, SquareCode, Workflow, Undo2, Redo2, Heading, ChevronDown, Sigma } from 'lucide-react';
import { t, useLanguage } from '../../i18n';
import { ALERT_TYPES, EMOTICONS, EMOTICON_GROUPS } from './MarkdownFeatures';
import { SYMBOL_GROUPS } from './SymbolReplacements';
import { MERMAID_TEMPLATES } from './MermaidTemplates';

export function DescriptionToolbar({ editor, onError, historyTarget }: { editor: Editor | null; onError(error: unknown): void; historyTarget?: HTMLElement | null }) {
  useLanguage();
  const [open, setOpen] = useState<string | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef<1 | -1 | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const dropdown = toolbar.current?.querySelector<HTMLElement>('[data-editor-dropdown]');
    const anchor = dropdown?.parentElement?.querySelector('button');
    if (!dropdown || !anchor) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      dropdown.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - dropdown.offsetWidth - 8))}px`;
      dropdown.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - dropdown.offsetHeight - 8))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || keyboardOpen.current === null) return;
    const buttons = toolbar.current?.querySelectorAll<HTMLButtonElement>('[data-editor-dropdown] button');
    const direction = keyboardOpen.current;
    keyboardOpen.current = null;
    buttons?.[direction === 1 ? 0 : buttons.length - 1]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!toolbar.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'), strike: current.isActive('strike'),
    h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
    paragraph: current.isActive('paragraph'), bulletList: current.isActive('bulletList'),
    orderedList: current.isActive('orderedList'), taskList: current.isActive('taskList'),
    blockquote: current.isActive('blockquote'), code: current.isActive('code'),
    codeBlock: current.isActive('codeBlock') && !current.isActive('codeBlock', { language: 'mermaid' }),
    alert: current.getAttributes('alert').type,
    undo: current.can().undo(), redo: current.can().redo(),
  } : null });
  if (!editor || !state) return null;
  const text = t('Text');
  const groups = [
    { key: 'Überschriften', label: state.h1 ? t('Überschrift 1') : state.h2 ? t('Überschrift 2') : state.h3 ? t('Überschrift 3') : t('Absatz'), icon: Heading, items: [
      { label: t('Absatz'), syntax: text, shortcut: 'Ctrl+Alt+0', icon: Heading, active: state.paragraph, run: () => editor.chain().focus().setParagraph().run() },
      { label: t('Überschrift 1'), syntax: `# ${text}`, shortcut: 'Ctrl+Alt+1', icon: Heading1, active: state.h1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { label: t('Überschrift 2'), syntax: `## ${text}`, shortcut: 'Ctrl+Alt+2', icon: Heading2, active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { label: t('Überschrift 3'), syntax: `### ${text}`, shortcut: 'Ctrl+Alt+3', icon: Heading3, active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    ] },
    { key: 'Format', label: t('Format'), icon: Bold, items: [
      { label: t('Fett'), syntax: `**${t('Fett')}**`, shortcut: 'Ctrl+B', icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
      { label: t('Kursiv'), syntax: `*${t('Kursiv')}*`, shortcut: 'Ctrl+I', icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
      { label: t('Durchgestrichen'), syntax: `~~${text}~~`, shortcut: 'Ctrl+Shift+S', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
      { label: t('Inline-Code'), syntax: '`code`', shortcut: 'Ctrl+E', icon: Code, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
      { label: t('Formel'), syntax: '$E = mc^2$', icon: Sigma, run: () => editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex: 'E = mc^2' } }).run() },
    ] },
    { key: 'Listen', label: t('Listen'), icon: List, items: [
      { label: t('Aufzählung'), syntax: `- ${text}`, shortcut: 'Ctrl+Shift+8', icon: List, active: state.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
      { label: t('Nummerierte Liste'), syntax: `1. ${text}`, shortcut: 'Ctrl+Shift+7', icon: ListOrdered, active: state.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
      { label: t('Checkliste ein-/ausschalten'), syntax: `- [ ] ${text}`, shortcut: 'Ctrl+Shift+9', icon: ListTodo, active: state.taskList, run: () => editor.chain().focus().toggleTaskList().run() },
    ] },
    { key: 'Block', label: t('Block'), icon: SquareCode, items: [
      { label: t('Zitat'), syntax: `> ${text}`, shortcut: 'Ctrl+Shift+B', icon: Quote, active: state.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
      { label: t('Codeblock'), syntax: '```\ncode\n```', shortcut: 'Ctrl+Alt+C', icon: SquareCode, active: state.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
      { label: t('Formelblock'), syntax: '$$\nE = mc^2\n$$', icon: Sigma, run: () => editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: 'E = mc^2' } }).run() },
      ...['NOTE', 'WARNING', 'IMPORTANT', 'TIP', 'CAUTION'].map(type => {
        const item = ALERT_TYPES.find(alert => alert.type === type)!;
        return { label: t(item.labelKey), syntax: `> [!${type}]\n> ${text}`, emoji: item.icon, active: state.alert === type,
          run: () => state.alert && state.alert !== type
            ? editor.chain().focus().updateAttributes('alert', { type }).run()
            : editor.chain().focus().toggleWrap('alert', { type }).run() };
      }),
    ] },
    { key: 'Sonderzeichen', label: t('Sonderzeichen'), icon: Sigma, items: [] },
    { key: 'Symbole', label: t('Symbole'), icon: ListTodo, items: [] },
    { key: 'Mermaid', label: t('Mermaid'), icon: Workflow, items: MERMAID_TEMPLATES.map(item => ({
      label: t(item.labelKey), syntax: `\`\`\`mermaid\n${item.source}\n\`\`\``,
      run: () => editor.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: item.source }] }).run(),
    })) },
  ];
  type Action = { label: string; syntax: string; shortcut?: string; icon?: typeof Bold; emoji?: string; color?: string; active?: boolean; run(): unknown };
  const run = (action: Action) => { try { action.run(); setOpen(null); } catch (error) { onError(error); } };
  const itemButton = (action: Action) => <button key={action.label} type="button" title={action.syntax} aria-label={action.label} aria-pressed={action.active}
    className={`flex w-full items-center ${open === 'Symbole' ? 'gap-1 px-1' : 'gap-2 px-2'} rounded py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-sky-600 ${action.active ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
    onMouseDown={event => event.preventDefault()} onClick={() => run(action)}>
    {action.icon ? <action.icon size={16} aria-hidden="true" /> : action.emoji && <span aria-hidden="true" style={{ color: action.color, filter: action.color === 'gray' ? 'grayscale(1)' : undefined, WebkitTextStroke: action.color === '#ffffff' ? '1px #64748b' : undefined }}>{action.emoji}</span>}
    {action.emoji ? <code className="whitespace-pre" style={{ fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "clig" 0, "calt" 0' }}>{action.label}</code> : action.label}
    {action.shortcut && <kbd className="ml-auto shrink-0 whitespace-nowrap pl-3 text-[10px] text-slate-500">{action.shortcut}</kbd>}
  </button>;
  const historyButtons = <div data-editor-history className="ml-auto flex shrink-0 items-center gap-1">
    {[
      { label: t('Rückgängig'), syntax: 'Ctrl+Z', icon: Undo2, disabled: !state.undo, run: () => editor.chain().focus().undo().run() },
      { label: t('Wiederholen'), syntax: 'Ctrl+Y / Ctrl+Shift+Z', icon: Redo2, disabled: !state.redo, run: () => editor.chain().focus().redo().run() },
    ].map(action => <button key={action.label} type="button" title={action.syntax} aria-label={action.label} disabled={action.disabled}
      className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-sky-600 disabled:opacity-30"
      onMouseDown={event => event.preventDefault()} onClick={() => run(action)}><action.icon size={16} aria-hidden="true" /></button>)}
  </div>;
  return <div ref={toolbar} role="group" aria-label={t('Textformatierung')}
    className="relative z-10 flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-3 py-2"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null); }}>
    {groups.map(group => <div key={group.key} className="relative" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(null); event.currentTarget.querySelector('button')?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !['Sonderzeichen', 'Symbole'].includes(group.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        if (open !== group.key) { keyboardOpen.current = direction; setOpen(group.key); }
        else {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-editor-dropdown] button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const columns = group.key === 'Sonderzeichen' ? 3 : group.key === 'Symbole' ? 4 : 1;
          const step = ['ArrowDown', 'ArrowUp'].includes(event.key) ? columns : 1;
          const next = index < 0 ? direction === 1 ? 0 : buttons.length - 1 : (index + direction * step + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }
    }}>
      <button type="button" aria-label={t(group.key)} aria-expanded={open === group.key}
        className="flex h-7 items-center gap-1 rounded px-1.5 text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-sky-600"
        onMouseDown={event => event.preventDefault()} onClick={() => setOpen(open === group.key ? null : group.key)}>
        <group.icon size={16} aria-hidden="true" /><span className="text-[11px]">{group.label}</span><ChevronDown size={12} aria-hidden="true" />
      </button>
      {open === group.key && <div data-editor-dropdown className={`fixed z-50 max-h-[min(20rem,calc(100vh-1rem))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg ${['Sonderzeichen', 'Symbole'].includes(group.key) ? 'w-72' : 'w-max min-w-56'}`}>
        {group.items.map(itemButton)}
        {group.key === 'Sonderzeichen' && <>
          {SYMBOL_GROUPS.map(section => <section key={section.labelKey}>
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-600">{t(section.labelKey)}</div>
            <div className="grid grid-cols-3 gap-1" data-symbol-group={section.labelKey}>
              {section.items.map(item => itemButton({ label: item.shortcut, syntax: item.shortcut, emoji: item.symbol,
                run: () => editor.chain().focus().insertContent(item.latex ? { type: 'inlineMath', attrs: { latex: item.latex } } : { type: 'text', text: item.symbol }).run() }))}
              {section.labelKey === 'Typografie' && EMOTICONS.filter(item => ['(c)', '(R)', '(TM)'].includes(item.shortcut)).map(item => itemButton({ label: item.shortcut, syntax: item.shortcut, emoji: item.emoji,
                run: () => editor.chain().focus().insertContent({ type: 'emoticon', attrs: { shortcut: item.shortcut } }).run() }))}
            </div>
          </section>)}
        </>}
        {group.key === 'Symbole' && EMOTICON_GROUPS.filter(section => section.labelKey !== 'Typografie').map(section => <section key={section.labelKey}>
          <div className="px-2 py-1.5 text-xs font-semibold text-slate-600">{t(section.labelKey)}</div>
          <div className="grid grid-cols-4 gap-0" data-emoticon-group={section.labelKey}>
            {section.items.map(item => itemButton({ label: item.shortcut, syntax: item.shortcut, emoji: item.emoji, color: item.color,
              run: () => editor.chain().focus().insertContent({ type: 'emoticon', attrs: { shortcut: item.shortcut } }).run() }))}
          </div>
        </section>)}
      </div>}
    </div>)}
    {historyTarget ? createPortal(historyButtons, historyTarget) : historyButtons}
  </div>;
}
