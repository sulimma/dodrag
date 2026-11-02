import React, { useEffect, useRef, useState } from 'react';
import { durationUnits, validTiming, type DurationUnit, type TaskTiming } from '../domain/duration';
import { locale, t, useLanguage } from '../i18n';

const unitLabels = { minutes: 'Minuten', hours: 'Stunden', days: 'Tage' };
// Keep incomplete numeric drafts local. Commit the complete tuple on leaving the
// group, Enter, or unit selection so duration/progress never persist separately.
export function TaskTimingInput({ value, onSave, onError, defaultOnly = false }: {
  value: TaskTiming; onSave: (value: TaskTiming) => Promise<void>;
  onError: (error: unknown) => void; defaultOnly?: boolean;
}) {
  const language = useLanguage();
  const display = (number: number | null) => number === null ? '' : new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 10 }).format(number);
  const [duration, setDuration] = useState(() => display(value.duration));
  const [progress, setProgress] = useState(() => display(value.progress));
  const [unit, setUnit] = useState(value.durationUnit);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const reset = () => { setDuration(display(value.duration)); setProgress(display(value.progress)); setUnit(value.durationUnit); };
  useEffect(reset, [value.duration, value.progress, value.durationUnit, language]);
  const commit = async (selectedUnit = unit) => {
    if (saving.current) return;
    const parse = (raw: string) => /^[0-9]+(?:[.,][0-9]+)?$/.test(raw.trim()) ? Number(raw.trim().replace(',', '.')) : NaN;
    const next = { duration: parse(duration), progress: defaultOnly || !progress.trim() ? null : parse(progress), durationUnit: selectedUnit };
    if (!validTiming(next)) {
      onError(new Error(t('Ungültige Dauer oder Fortschritt')));
      reset();
      return;
    }
    if (next.duration === value.duration && next.progress === value.progress && next.durationUnit === value.durationUnit) return;
    saving.current = true; setBusy(true);
    try { await onSave(next); }
    catch (error) { reset(); onError(error); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-normal" title={t('Fortschritt / Dauer')}
    onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void commit(); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); (event.target as HTMLElement).blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); }
    }}>
    {!defaultOnly && <><input type="text" inputMode="decimal" aria-label={t('Fortschritt')} disabled={busy}
      value={progress} onChange={event => setProgress(event.target.value)} className="w-12 min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-right" /><span>/</span></>}
    <input type="text" inputMode="decimal" aria-label={t(defaultOnly ? 'Standarddauer' : 'Dauer')} disabled={busy}
      value={duration} onChange={event => setDuration(event.target.value)} className="w-12 min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-right" />
    <select aria-label={t('Einheit')} value={unit} disabled={busy} className="max-w-24 rounded border border-slate-300 bg-white py-0.5"
      onChange={event => { const selected = event.target.value as DurationUnit; setUnit(selected); void commit(selected); }}>
      {durationUnits.map(item => <option key={item} value={item}>{t(unitLabels[item])}</option>)}
    </select>
  </div>;
}
