import { classifyTarget, fileDropText } from '../components/editor/targets';
import type { DescriptionAddition } from '../components/editor/markdownImport';
import { t } from '../i18n';

export function appendTaskSources(description: string, sources: readonly DescriptionAddition[]): string {
  const entries = sources.map(source => {
    if (source.kind === 'markdown') return source.value;
    const target = classifyTarget(source.value);
    if (!target || target.kind !== source.kind) throw new Error(t('Ungültige URL'));
    return target.kind === 'path' ? fileDropText([target.value]) : `<${target.value}>`;
  });
  return entries.length ? [description.trimEnd(), ...entries].filter(Boolean).join('\n\n') : description;
}
