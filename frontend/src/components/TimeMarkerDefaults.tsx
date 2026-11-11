import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatMarkerTime, parseMarkerTime } from '../domain/timeMarkers';
import { t } from '../i18n';

function TimeValue({ minute, save, disabled, onError }: { minute: number; save: (minute: number) => Promise<void>; disabled: boolean; onError: (error: unknown) => void }) {
 const [draft, setDraft] = useState(formatMarkerTime(minute));
 const commit = async () => {
   const value = parseMarkerTime(draft);
   if (value === null) { setDraft(formatMarkerTime(minute)); onError(new Error(t('Ungültige Uhrzeit'))); return; }
   await save(value);
   setDraft(formatMarkerTime(minute));
 };
 return <input aria-label={t('Uhrzeitmarker')} value={draft} disabled={disabled}
   className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs" onFocus={event => event.currentTarget.select()}
   onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
   onKeyDown={event => {
     if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
     if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(formatMarkerTime(minute)); }
   }} />;
}
export function TimeMarkerDefaults({ minutes, onSave, onError }: {
 minutes: number[]; onSave: (minutes: number[]) => Promise<void>; onError: (error: unknown) => void;
}) {
 const [busy, setBusy] = useState(false);
 const save = async (values: number[]) => {
   if (busy) return;
   const sorted = [...values].sort((a, b) => a - b);
   if (new Set(sorted).size !== sorted.length) { onError(new Error(t('Diese Uhrzeit ist bereits vorhanden'))); return; }
   setBusy(true);
   try { await onSave(sorted); } catch (error) { onError(error); } finally { setBusy(false); }
 };
 return <section className="rounded-xl border border-slate-200 p-3 space-y-2">
   <div className="flex items-center justify-between text-xs font-semibold"><span>{t('Tägliche Uhrzeitmarker')}</span>
     <button type="button" disabled={busy || minutes.length >= 96} aria-label={t('Uhrzeitmarker hinzufügen')}
       className="rounded p-1 hover:bg-slate-100 disabled:opacity-40" onClick={() => {
         let minute = 720;
         while (minutes.includes(minute) && minute < 1439) minute++;
         if (minutes.includes(minute)) { minute = 0; while (minutes.includes(minute)) minute++; }
         void save([...minutes, minute]);
       }}><Plus className="h-4 w-4" /></button>
   </div>
   <p className="text-xs text-slate-500">{t('Neue Tage übernehmen diese Zeiten. Bereits angelegte Tage behalten ihre eigenen Marker.')}</p>
   <div className="flex flex-col gap-1">{minutes.map((minute, index) => <div key={minute} className="flex items-center gap-2">
     <TimeValue minute={minute} disabled={busy} onError={onError} save={value => save(minutes.map((old, i) => i === index ? value : old))} />
     <button type="button" disabled={busy} aria-label={t('Uhrzeitmarker löschen')} className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
       onClick={() => void save(minutes.filter((_, i) => i !== index))}><Trash2 className="h-3.5 w-3.5" /></button>
   </div>)}</div>
 </section>;
}
