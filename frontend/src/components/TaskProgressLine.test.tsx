// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TaskProgressLine } from './TaskProgressLine';
import { projectEvents } from '../domain/projector';
const iso = '2026-11-02T09:00:00Z';
const task = projectEvents([{ type: 'TASK_CREATED', payload: { taskId: 'a', title: 'A', configuredStart: iso, createdAt: iso }, seq: 1, id: 'e1', timestamp: iso, undone: false }], new Date(iso)).tasks.a;
it.each([null, 0, 1])('never shows completed task progress, including checklist fallback (%s)', progress => {
  const value = { ...task, progress, checklistProgress: { checked: 1, total: 2 } };
  expect(renderToStaticMarkup(<TaskProgressLine task={value} />)).toContain('progressbar');
  expect(renderToStaticMarkup(<TaskProgressLine task={{ ...value, completed: true }} />)).toBe('');
});
