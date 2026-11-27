import { t } from '../i18n';
import { CopyTaskSummary } from './copy-task-summary/CopyTaskSummary';

// Built-in contributions only. The Go settings allowlist is checked against these IDs.
export const plugins = [{
  id: 'copy-task-summary',
  label: () => t('Task-Zusammenfassung kopieren'),
  description: () => t('Kopiert ID, Titel, Status und wirksames Datum des Tasks als Klartext.'),
  TaskDetailAction: CopyTaskSummary,
}, {
  id: 'time-measurement',
  label: () => t('Zeiterfassung'),
  description: () => t('Misst Arbeitszeit pro Task und speichert die Sitzungen in der Datenbank.'),
}] as const;

export interface PluginSettingsRow {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}
