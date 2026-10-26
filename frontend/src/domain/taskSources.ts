import { classifyTarget, fileDropText } from '../components/editor/targets';
import type { EditorTarget } from '../components/editor/types';
import { t } from '../i18n';

export function appendTaskSources(description: string, sources: readonly EditorTarget[]): string {
  const entries = sources.map(source => {
    const target = classifyTarget(source.value);
    if (!target || target.kind !== source.kind) throw new Error(t('Ungültige URL'));
    return target.kind === 'path' ? fileDropText([target.value]) : `<${target.value}>`;
  });
  return entries.length ? [description.trimEnd(), ...entries].filter(Boolean).join('\n\n') : description;
}
