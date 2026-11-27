// Platforms with a custom compact window also own the client-side caption.
// Decorated windows keep their native titlebar and controls.
export { AppTitleBar as DesktopTitleBar } from './components/AppTitleBar';

type ModifierKeys = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>;

export function hasCommandModifier(event: ModifierKeys): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey;
}
