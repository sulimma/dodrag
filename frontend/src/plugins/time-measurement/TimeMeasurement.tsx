import React, { useEffect, useId, useState } from 'react';
import { Timer } from 'lucide-react';
import type { TaskState } from '../../domain/types';
import { locale, t, useLanguage } from '../../i18n';
import type { TimeMeasurementSession } from './types';
import type { TimeMeasurement } from './useTimeMeasurement';

const actionStyle = 'shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50';

function durationText(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const format = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => format.format(n)).join(':');
}

function isoTime(ms: number) {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function Elapsed({ startMs }: { startMs: number }) {
  useLanguage();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="shrink-0 font-mono tabular-nums" aria-live="off">{durationText(now - startMs)}</span>;
}

export function TimeMeasurementButton({ timer, task, taskTitle, disabled, inTaskRow = false }: {
  timer: TimeMeasurement;
  task: TaskState | null;
  taskTitle?: string;
  disabled: boolean;
  inTaskRow?: boolean;
}) {
  const current = timer.state?.running;
  const creationId = task && timer.creationId(task.id);
  const running = current && (!inTaskRow || (current.taskId === task?.id && current.taskCreationEventId === creationId))
    ? current : null;
  const canStart = Boolean(timer.state && !timer.state.interrupted && task && !task.completed && creationId);
  const label = running ? t('Messung stoppen') : t('Messung starten');
  const visibleTitle = !inTaskRow ? (running ? taskTitle ?? running.taskId : task?.title) : undefined;
  const savedTime = inTaskRow && task && timer.state ? durationText(timer.savedTotal(task.id)) : undefined;
  const savedLabel = savedTime && t('Gespeicherte Zeit: {duration}', { duration: savedTime });
  const title = running ? `${label} — ${t('Laufende Messung: {task}', { task: taskTitle ?? running.taskId })}`
    : visibleTitle ? `${label} — ${visibleTitle}` : label;
  return <button type="button" aria-label={label} aria-description={savedLabel} title={savedLabel ? `${title} — ${savedLabel}` : title}
    disabled={disabled || timer.pending || (!running && !canStart)}
    onClick={event => {
      event.stopPropagation();
      if (running) void timer.stop(running);
      else if (task && creationId) void timer.start(task.id, creationId);
    }}
    className={`flex items-center transition-colors disabled:opacity-35 ${inTaskRow
      ? 'shrink-0 gap-1 rounded border p-0.5 text-[10px]' : 'min-w-0 gap-1.5 rounded-lg border border-transparent p-1.5 text-xs'} ${running
      ? 'border-sky-200 bg-sky-100 text-sky-700 hover:bg-sky-200/60'
      : `text-slate-500 hover:bg-slate-200/60 hover:text-slate-700 ${inTaskRow ? 'border-slate-200 bg-slate-100' : ''}`}`}>
    <Timer className={inTaskRow ? 'h-3 w-3 shrink-0' : 'h-4 w-4 shrink-0'} aria-hidden="true" />
    {!inTaskRow && running ? <Elapsed key={running.id} startMs={running.startMs} /> :
      (!inTaskRow || savedTime !== undefined) && <span className="shrink-0 font-mono tabular-nums">{savedTime ?? durationText(0)}</span>}
    {visibleTitle && <span className="max-w-28 truncate">{visibleTitle}</span>}
  </button>;
}

function parseISOEnd(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value.trim());
  if (!match) return null;
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const timestamp = Date.parse(canonical);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === canonical ? timestamp : null;
}

function EndTimeForm({ initial, example, pending, cancel, submit }: {
  initial?: number;
  example: number;
  pending: boolean;
  cancel: () => void;
  submit: (endMs: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial === undefined ? '' : isoTime(initial));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  return <form className="flex flex-wrap items-center gap-2" onSubmit={event => {
    event.preventDefault();
    const endMs = parseISOEnd(value);
    setInvalid(endMs === null);
    if (endMs !== null) void submit(endMs);
  }}>
    <label className="flex flex-wrap items-center gap-1">{t('Endzeit (UTC)')}
      <input type="text" autoFocus value={value} placeholder={isoTime(example)} spellCheck={false}
        disabled={pending} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        onChange={event => { setValue(event.target.value); setInvalid(false); }} className="rounded border px-1 font-mono" />
    </label>
    <button type="submit" className={actionStyle} disabled={pending}>{t('Endzeit speichern')}</button>
    <button type="button" className={actionStyle} disabled={pending} onClick={cancel}>{t('Abbrechen')}</button>
    {invalid && <span id={errorId} role="alert" className="text-rose-800">{t('Ungültige Endzeit')}</span>}
  </form>;
}

export function TimeMeasurementDetails({ timer, task, creationId, disabled }: {
  timer: TimeMeasurement;
  task: TaskState;
  creationId: string;
  disabled: boolean;
}) {
  const [action, setAction] = useState<{ id: number; kind: 'edit' | 'delete' } | null>(null);
  const state = timer.state;
  const sameTask = (session: TimeMeasurementSession) => session.taskId === task.id && session.taskCreationEventId === creationId;
  const sessions = state?.sessions.filter(sameTask) ?? [];
  const running = state?.running && sameTask(state.running) ? state.running : null;
  const busy = timer.pending || disabled;
  return <section aria-label={t('Zeiterfassung')} className="max-h-[22vh] overflow-y-auto shrink-0 space-y-1 border-b border-slate-200 px-3 py-1 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      {running ? <>
        <button type="button" className={actionStyle} disabled={busy} onClick={() => void timer.stop(running)}>{t('Messung stoppen')}</button>
        <Elapsed startMs={running.startMs} />
      </> : <button type="button" className={actionStyle} disabled={busy || !state || Boolean(state.interrupted) || task.completed}
        onClick={() => void timer.start(task.id, creationId)}>{t('Messung starten')}</button>}
      {state && <span>{t('Gespeicherte Zeit: {duration}', { duration: durationText(timer.savedTotal(task.id)) })}</span>}
    </div>
    {state && <details>
      <summary className="cursor-pointer">{t('Sitzungsverlauf')}</summary>
      {sessions.length === 0 ? <p>{t('Keine gespeicherten Sitzungen')}</p> : <ul className="divide-y divide-slate-100">
        {sessions.map(session => <li key={session.id} className="space-y-1 py-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono">{isoTime(session.startMs)} – {isoTime(session.endMs!)}</span>
            <span className="font-mono">({durationText(session.elapsedMs!)})</span>
            <button type="button" className={actionStyle} disabled={busy} onClick={() => setAction({ id: session.id, kind: 'edit' })}>{t('Endzeit ändern')}</button>
            <button type="button" className={actionStyle} disabled={busy} onClick={() => setAction({ id: session.id, kind: 'delete' })}>{t('Sitzung löschen')}</button>
          </div>
          {action?.id === session.id && (action.kind === 'edit'
            ? <EndTimeForm initial={session.endMs!} example={session.startMs} pending={busy} cancel={() => setAction(null)} submit={async endMs => {
              const ok = await timer.edit(session, endMs);
              if (ok) setAction(null);
              return ok;
            }} />
            : <div className="flex flex-wrap items-center gap-2">
              <span>{t('Diese Sitzung löschen?')}</span>
              <button type="button" autoFocus className={actionStyle} disabled={busy} onClick={() => setAction(null)}>{t('Abbrechen')}</button>
              <button type="button" className={actionStyle} disabled={busy} onClick={async () => {
                if (await timer.remove(session)) setAction(null);
              }}>{t('löschen')}</button>
            </div>)}
        </li>)}
      </ul>}
    </details>}
  </section>;
}

function Recovery({ timer, session, miniRestore, disabled }: {
  timer: TimeMeasurement;
  session: TimeMeasurementSession;
  miniRestore?: () => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const busy = timer.pending || disabled;
  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
    <span className="min-w-0 flex-1 truncate" title={t('Unterbrochene Messung seit {start}', { start: isoTime(session.startMs) })}>
      {t('Unterbrochene Messung seit {start}', { start: isoTime(session.startMs) })}
    </span>
    {!editing && <button type="button" className={actionStyle} disabled={busy}
      onClick={miniRestore ?? (() => setEditing(true))}>{t('Endzeit wählen')}</button>}
    {!miniRestore && <button type="button" className={actionStyle} disabled={busy} onClick={() => void timer.recover(session, null)}>{t('Messung verwerfen')}</button>}
    {editing && <EndTimeForm example={session.startMs} pending={busy} cancel={() => setEditing(false)} submit={endMs => timer.recover(session, endMs)} />}
  </div>;
}

export function TimeMeasurementStatus({ timer, taskTitle, hideRunning, miniRestore, disabled }: {
  timer: TimeMeasurement;
  taskTitle?: string;
  hideRunning?: boolean;
  miniRestore?: () => void;
  disabled: boolean;
}) {
  const state = timer.state;
  const running = state?.running;
  const interrupted = state?.interrupted;
  return <>
    <div role="status" className="sr-only">{timer.announcement}</div>
    {timer.loadError && (!miniRestore || !running && !interrupted) && <div className="flex h-7 shrink-0 items-center gap-2 bg-amber-50 px-2 text-xs">
      <span role="alert" className="min-w-0 truncate" title={timer.loadError}>{timer.loadError}</span>
      <button type="button" className={actionStyle} disabled={timer.pending || disabled} onClick={timer.refresh}>{t('Erneut versuchen')}</button>
    </div>}
    {interrupted && <div className={`${miniRestore ? 'flex h-7 items-center' : 'py-1'} shrink-0 bg-amber-50 px-2 text-xs`}>
      <Recovery key={interrupted.id} timer={timer} session={interrupted} miniRestore={miniRestore} disabled={disabled} />
    </div>}
    {running && !hideRunning && <div className="flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-sky-200 bg-sky-100 px-2 py-1 text-xs text-sky-700">
      <span className="min-w-0 truncate" title={t('Laufende Messung: {task}', { task: taskTitle ?? running.taskId })}>
        {t('Laufende Messung: {task}', { task: taskTitle ?? running.taskId })}
      </span>
      <Elapsed key={running.id} startMs={running.startMs} />
      <button type="button" className={actionStyle} disabled={timer.pending || disabled} onClick={() => void timer.stop(running)}>{t('Messung stoppen')}</button>
    </div>}
  </>;
}
