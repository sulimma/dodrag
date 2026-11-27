import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventBridge, type TaskMenuAnchor, type TaskMenuItem } from '../bridge/eventBridge';
import { contextMenuAnchor } from '../hooks/keyboardNavigation';
import { t } from '../i18n';

interface MenuPosition {
  nativeAnchor?: TaskMenuAnchor;
  point: TaskMenuAnchor;
  target?: Element;
}

type ShowMenu = (items: TaskMenuItem[], position: MenuPosition, signal?: AbortSignal) => Promise<string>;
const showNativeMenu: ShowMenu = (items, position) => eventBridge.showTaskContextMenu(items, position.nativeAnchor);
export const ContextMenuDispatch = createContext<ShowMenu>(showNativeMenu);
export const useContextMenu = () => useContext(ContextMenuDispatch);

export function menuPosition(event: React.MouseEvent): MenuPosition {
  const nativeAnchor = contextMenuAnchor(event);
  return { nativeAnchor, point: nativeAnchor ?? { x: event.clientX, y: event.clientY }, target: event.currentTarget };
}

interface MenuRequest {
  items: TaskMenuItem[];
  position: MenuPosition;
  returnFocus: HTMLElement | null;
  finish: (id: string) => void;
}

// Only one popup owns focus. Both renderers return the same action IDs; app
// callers keep their existing checks for task, database and selection changes.
export function useDesktopContextMenu(native: boolean, databaseKey?: string) {
  const pending = useRef<MenuRequest | null>(null);
  const [request, setRequest] = useState<MenuRequest | null>(null);
  useLayoutEffect(() => () => pending.current?.finish(''), [native, databaseKey]);
  const showInApp = useCallback<ShowMenu>((items, position, signal) => {
    if (!items.length || signal?.aborted) return Promise.resolve('');
    const returnFocus = pending.current?.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    pending.current?.finish('');
    return new Promise(resolve => {
      const abort = () => next.finish('');
      const next: MenuRequest = { items, position, returnFocus, finish: id => {
        if (pending.current !== next) return;
        pending.current = null;
        signal?.removeEventListener('abort', abort);
        setRequest(null);
        resolve(id);
      } };
      pending.current = next;
      signal?.addEventListener('abort', abort, { once: true });
      setRequest(next);
    });
  }, []);
  return {
    showMenu: native ? showNativeMenu : showInApp,
    popup: !native && request ? <ContextMenuPopup request={request} /> : null,
  };
}

function ContextMenuPopup({ request }: { request: MenuRequest }) {
  const menu = useRef<HTMLDivElement>(null);
  const actions = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const { x, y } = request.position.point;
  useLayoutEffect(() => {
    const node = menu.current!;
    const place = () => {
      const { width, height } = node.getBoundingClientRect();
      node.style.left = Math.max(0, Math.min(x, window.innerWidth - width)) + 'px';
      node.style.top = Math.max(0, Math.min(y, window.innerHeight - height)) + 'px';
    };
    place();
    (actions()[0] ?? node).focus();
    const dismiss = () => request.finish('');
    window.addEventListener('resize', place);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('blur', dismiss);
      if (node.contains(document.activeElement) && request.returnFocus?.isConnected) {
        request.returnFocus.focus({ preventScroll: true });
      }
    };
  }, [request, x, y]);
  // A native modal dialog sits above the document in the top layer. Keep its
  // popup inside that dialog so the browser does not make it inert.
  const host = request.position.target?.closest('dialog[open]') ?? document.body;
  return createPortal(<div className="fixed inset-0 z-[1000]" onClick={event => {
    event.stopPropagation();
    if (event.target === event.currentTarget) request.finish('');
  }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); request.finish(''); }}>
    <div ref={menu} role="menu" aria-label={t('Kontextmenü')} tabIndex={-1}
      className="fixed max-h-screen max-w-[min(26rem,100vw)] min-w-40 overflow-auto rounded border border-slate-300 bg-white p-1 text-sm text-slate-900 shadow-lg"
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); request.finish(''); return; }
        const items = actions();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % items.length
            : event.key === 'ArrowUp' ? (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length) : -1;
        if (index !== -1) { event.preventDefault(); items[index].focus(); }
      }}>
      {request.items.map(item => item.separator ? <hr key={item.id} role="separator" className="my-1 border-slate-200" />
        : <button key={item.id} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
          className="flex w-full items-baseline justify-between gap-4 rounded px-2 py-1 text-left hover:bg-sky-50 focus:bg-sky-100 focus:outline-none disabled:text-slate-500 disabled:hover:bg-white"
          onClick={() => request.finish(item.id)}>
          <span className="min-w-0 break-all">{item.label}</span>
          {item.shortcut && <span aria-hidden="true" className="shrink-0 text-xs text-slate-500">{item.shortcut}</span>}
        </button>)}
    </div>
  </div>, host);
}
