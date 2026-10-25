import { eventBridge, type TaskMenuItem } from '../../bridge/eventBridge';
import { t } from '../../i18n';
import type { EditorTarget } from './types';

export function targetMenuItems(target?: EditorTarget): TaskMenuItem[] {
  if (!target) return [];
  return target.kind === 'url'
    ? [{ id: 'url:open', label: t('Im Browser öffnen'), disabled: false }]
    : [{ id: 'path:explorer', label: t('Im Explorer öffnen'), disabled: false },
      { id: 'path:vscode', label: t('In VS Code öffnen'), disabled: false }];
}

export async function openTarget(target: EditorTarget, action?: string): Promise<void> {
  if (target.kind === 'url') await eventBridge.openExternalURL(target.value);
  else if (action === 'path:vscode') await eventBridge.openPathInVSCode(target.value);
  else await eventBridge.openPathInExplorer(target.value);
}
