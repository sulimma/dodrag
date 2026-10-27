// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { contextMenuAnchor, focusNextRegion, openKeyboardContextMenu, shortcutLabel } from './keyboardNavigation';
import { setLanguage, supportedLanguages, t } from '../i18n';

afterEach(() => { document.body.replaceChildren(); setLanguage('de'); });

it('retains translated action labels and exact technical key codes in every language', () => {
  for (const language of supportedLanguages) {
    setLanguage(language);
    expect(shortcutLabel(t('Liste'), 'Ctrl+1')).toBe(`${t('Liste')} (Ctrl+1)`);
    expect(shortcutLabel(t('+1 Tag'), 'Ctrl++')).toBe(`${t('+1 Tag')} (Ctrl++)`);
  }
});

it('cycles nested regions in explicit order, skips hidden ones and handles no regions', () => {
  focusNextRegion(false);
  document.body.innerHTML = '<div data-shortcut-region="2" tabindex="0"><div data-shortcut-region="3"><textarea></textarea></div></div><div data-shortcut-region="0"><button>first</button></div><div hidden data-shortcut-region="1" tabindex="0"></div>';
  focusNextRegion(false); expect(document.activeElement?.tagName).toBe('BUTTON');
  focusNextRegion(false); expect((document.activeElement as HTMLElement).dataset.shortcutRegion).toBe('2');
  focusNextRegion(false); expect(document.activeElement?.tagName).toBe('TEXTAREA');
  focusNextRegion(true); expect((document.activeElement as HTMLElement).dataset.shortcutRegion).toBe('2');
});

it('marks only keyboard context events with a clamped client anchor', () => {
  const target = document.createElement('button'); document.body.append(target);
  target.getBoundingClientRect = () => new DOMRect(-10, window.innerHeight, 20, 50);
  target.addEventListener('contextmenu', event => {
    expect(contextMenuAnchor({ nativeEvent: event })).toEqual({ x: 0, y: window.innerHeight });
  });
  openKeyboardContextMenu(target);
  expect(contextMenuAnchor({ nativeEvent: new MouseEvent('contextmenu') })).toBeUndefined();
});
