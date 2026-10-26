import { eventBridge, type TaskMenuItem } from '../../bridge/eventBridge';
import { t } from '../../i18n';
import type { EditorTarget } from './types';

export function targetMenuItems(target?: EditorTarget, includeCreate = false): TaskMenuItem[] {
  if (!target) return [];
  const items = target.kind === 'url'
    ? [{ id: 'url:open', label: /^mailto:/i.test(target.value) ? `📧 ${t('Mail-App')}` : /^(?:tel|sip):/i.test(target.value) ? `🖁 ${t('Anrufen')}` : t('Im Browser öffnen'), disabled: false }]
    : [{ id: 'path:explorer', label: t('Im Explorer öffnen'), disabled: false },
      { id: 'path:vscode', label: t('In VS Code öffnen'), disabled: false }];
  if (includeCreate) items.push({ id: 'source:create', label: t('Neuen Task für diese Quelle erstellen'), disabled: false });
  return items;
}

export async function openTarget(target: EditorTarget, action?: string): Promise<void> {
  if (target.kind === 'url') await eventBridge.openExternalURL(target.value);
  else if (action === 'path:vscode') await eventBridge.openPathInVSCode(target.value);
  else await eventBridge.openPathInExplorer(target.value);
}
