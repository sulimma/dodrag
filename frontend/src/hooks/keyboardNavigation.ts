import type { TaskMenuAnchor } from '../bridge/eventBridge';

type KeyboardContextEvent = MouseEvent & { keyboardMenuAnchor?: TaskMenuAnchor };

export function shortcutLabel(label: string, shortcut: string): string { return `${label} (${shortcut})`; }

export function contextMenuAnchor(event: { nativeEvent: MouseEvent }): TaskMenuAnchor | undefined {
  return (event.nativeEvent as KeyboardContextEvent).keyboardMenuAnchor;
}

export function openKeyboardContextMenu(target: Element): void {
  const bounds = target.getBoundingClientRect();
  const anchor = { x: Math.max(0, Math.min(window.innerWidth, bounds.left)),
    y: Math.max(0, Math.min(window.innerHeight, bounds.bottom)) };
  const event: KeyboardContextEvent = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: anchor.x, clientY: anchor.y,
  });
  event.keyboardMenuAnchor = anchor;
  target.dispatchEvent(event);
}

export function focusNextRegion(backwards: boolean): void {
  const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-shortcut-region]'))
    .filter(region => !region.closest('[hidden],[inert]'))
    .sort((a, b) => Number(a.dataset.shortcutRegion) - Number(b.dataset.shortcutRegion));
  if (!regions.length) return;
  const currentRegion = (document.activeElement as Element | null)?.closest('[data-shortcut-region]');
  const current = regions.findIndex(region => region === currentRegion);
  const next = current < 0 ? backwards ? regions.length - 1 : 0
    : (current + (backwards ? -1 : 1) + regions.length) % regions.length;
  const region = regions[next];
  const target = region.hasAttribute('tabindex') ? region
    : region.querySelector<HTMLElement>('textarea:not(:disabled),[contenteditable="true"],input:not(:disabled)')
      ?? region.querySelector<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]');
  target?.focus();
}
