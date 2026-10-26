import React from 'react';
import { mediaSource, tokenizeTargets } from './targets';
import { SourceIcon } from './SourceIcon';

export function TargetText({ text, taskId }: { text: string; taskId: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const token of tokenizeTargets(text)) {
    parts.push(text.slice(cursor, token.start));
    parts.push(<SourceIcon key={`source:${token.start}`} target={token} />);
    parts.push(<span key={token.start} data-target-kind={token.kind} data-target-value={token.value}
      className="text-sky-700 underline cursor-pointer" role="link" tabIndex={0}>
      {token.label || text.slice(token.start, token.end)}
      {token.image && (token.kind === 'path' || /^https?:/i.test(token.value)) && <img src={token.kind === 'path' ? mediaSource(taskId, token.value) : token.value}
        alt={token.label ?? token.value} loading="lazy" className="max-h-64 max-w-full rounded-lg border border-slate-200 my-1.5 object-contain" />}
    </span>);
    cursor = token.end;
  }
  parts.push(text.slice(cursor));
  return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}
