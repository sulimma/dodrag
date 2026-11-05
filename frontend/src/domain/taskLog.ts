import { t } from '../i18n';
import type { TaskLogEntry } from './types';

export function taskCreatedText(copiedFromId?: string): string {
  return copiedFromId ? t('Aus {id} als Kopie erstellt', { id: copiedFromId }) : t('Task erstellt');
}

export function taskLifecycleText(entry: TaskLogEntry): string {
  switch (entry.lifecycle) {
    case 'created': return taskCreatedText(entry.copiedFromId);
    case 'completed': return t('Task geschlossen');
    case 'reopened': return t('Task erneut geöffnet');
    default: return '';
  }
}
