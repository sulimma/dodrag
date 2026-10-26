import React, { useEffect, useState } from 'react';
import { eventBridge } from '../../bridge/eventBridge';
import { t } from '../../i18n';
import { SOURCE_MIME } from './targets';
import type { EditorTarget } from './types';

function icon(target: EditorTarget, pathKind?: string): string {
  if (target.kind === 'path') return pathKind === 'directory' ? '📂' : '🖹';
  return /^mailto:/i.test(target.value) ? '📧' : /^(?:sip|tel):/i.test(target.value) ? '🖁' : '🌐';
}

function label(target: EditorTarget, pathKind?: string): string {
  return target.kind === 'path' && !pathKind ? t('Quelle ziehen (Pfadtyp nicht verfügbar)') : t('Quelle ziehen');
}

export function startSourceDrag(event: DragEvent | React.DragEvent, target: EditorTarget): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.clearData();
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(SOURCE_MIME, JSON.stringify({ kind: target.kind, value: target.value }));
  event.stopPropagation();
}

export function createSourceIcon(target: EditorTarget): HTMLElement {
  const element = document.createElement('span');
  element.dataset.sourceDrag = 'true';
  element.dataset.targetKind = target.kind; element.dataset.targetValue = target.value;
  element.draggable = true; element.contentEditable = 'false';
  element.className = 'dodrag-source-icon inline-block mx-1 cursor-grab select-none no-underline text-xs';
  const update = (kind?: string) => {
    element.textContent = icon(target, kind);
    element.title = label(target, kind); element.setAttribute('aria-label', element.title);
  };
  update();
  if (target.kind === 'path') void eventBridge.getPathKind(target.value).then(update).catch(() => {});
  element.addEventListener('dragstart', event => startSourceDrag(event, target));
  element.addEventListener('mousedown', event => event.stopPropagation());
  element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  return element;
}

export function SourceIcon({ target }: { target: EditorTarget }) {
  const [pathKind, setPathKind] = useState<string>();
  useEffect(() => {
    let active = true;
    setPathKind(undefined);
    if (target.kind === 'path') void eventBridge.getPathKind(target.value).then(kind => { if (active) setPathKind(kind); }).catch(() => {});
    return () => { active = false; };
  }, [target.kind, target.value]);
  return <span data-source-drag="true" data-target-kind={target.kind} data-target-value={target.value}
    draggable contentEditable={false} title={label(target, pathKind)} aria-label={label(target, pathKind)}
    className="dodrag-source-icon inline-block mx-1 cursor-grab select-none no-underline text-xs"
    onDragStart={event => startSourceDrag(event, target)} onMouseDown={event => event.stopPropagation()}
    onClick={event => { event.preventDefault(); event.stopPropagation(); }}>{icon(target, pathKind)}</span>;
}
