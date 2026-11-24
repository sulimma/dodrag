// Build-time desktop integration. A future target can supply its native
// caption and accelerator policy without changing the task views.
export { AppTitleBar as DesktopTitleBar } from './components/AppTitleBar';

type ModifierKeys = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>;

export function hasCommandModifier(event: ModifierKeys): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey;
}
