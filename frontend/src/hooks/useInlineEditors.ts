import { useRef, useState } from 'react';
import { eventBridge } from '../bridge/eventBridge';
import { TaskState } from '../domain/types';
import { formatIso8601Display } from '../domain/projector';
import { normalizeUserDate } from '../domain/dates';
import { normalizeTitleInput } from '../domain/input';
import { InlineEditor } from '../components/inlineEditor';
import { useDatabaseSnapshot } from './useDatabaseSnapshot';
export function useInlineEditors(
  database: Pick<
    ReturnType<typeof useDatabaseSnapshot>,
    'snapshotConfirmed' | 'databaseIdentity' | 'mutate'
  >,
  tasks: Record<string, TaskState>,
  now: Date,
  setLastMovedKey: (key: string) => void,
  closeContextMenu: () => void
) {
  const { snapshotConfirmed, databaseIdentity, mutate } = database;
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  // In-place configured date editing state (optional local time)
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(
    null
  );
  const [editingDateValue, setEditingDateValue] = useState<string>('');
  const editGroup = useRef('');
  const editRevision = useRef(0);
  const editSession = editGroup.current;
  const editDatabase = useRef('');
  // Each rendered commit captures its session; revision protects newer drafts in that session.
  const startInlineEdit = (task: TaskState) => {
    if (!snapshotConfirmed.current) return;
    editDatabase.current = databaseIdentity.current;
    editGroup.current = crypto.randomUUID();
    editRevision.current++;
    setEditingDateTaskId(null);
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
    closeContextMenu();
  };

  const commitInlineEdit = async () => {
    if (editSession !== editGroup.current) return;
    if (editDatabase.current !== databaseIdentity.current) return;
    if (!editingTaskId) return;
    const task = tasks[editingTaskId];
    const trimmed = normalizeTitleInput(editingTitle).trim();
    if (!task || !trimmed || trimmed === task.title) {
      setEditingTaskId(null);
      return;
    }

    const revision = editRevision.current;
    const updated = await mutate(() =>
      eventBridge.appendEvent(
        'TASK_RENAMED',
        {
          taskId: task.id,
          title: trimmed,
        },
        editSession
      )
    );
    // Only the unchanged originating editor may be closed by this response.
    if (
      updated &&
      editSession === editGroup.current &&
      revision === editRevision.current
    )
      setEditingTaskId(null);
  };

  const startInlineDateEdit = (task: TaskState) => {
    if (!snapshotConfirmed.current) return;
    editDatabase.current = databaseIdentity.current;
    editGroup.current = crypto.randomUUID();
    editRevision.current++;
    setEditingTaskId(null);
    setEditingDateTaskId(task.id);
    const { isoText } = formatIso8601Display(task.configuredStart);
    setEditingDateValue(isoText);
    closeContextMenu();
  };

  const commitInlineDateEdit = async () => {
    if (editSession !== editGroup.current) return;
    if (editDatabase.current !== databaseIdentity.current) return;
    if (!editingDateTaskId) return;
    const task = tasks[editingDateTaskId];
    const currentInput = editingDateValue;
    if (!task) return;

    if (
      currentInput.trim() === formatIso8601Display(task.configuredStart).isoText
    ) {
      setEditingDateTaskId(null);
      return;
    }

    const parsedIso = normalizeUserDate(currentInput, now);
    if (Date.parse(task.configuredStart) === Date.parse(parsedIso)) {
      setEditingDateTaskId(null);
      return;
    }

    setLastMovedKey(`task:${task.id}`);
    const revision = editRevision.current;
    const updated = await mutate(() =>
      eventBridge.appendEvent(
        'TASK_START_DATE_SET',
        {
          taskId: task.id,
          configuredStart: parsedIso,
        },
        editSession
      )
    );
    if (
      updated &&
      editSession === editGroup.current &&
      revision === editRevision.current
    )
      setEditingDateTaskId(null);
  };
  const cancelEdit = () => {
    editGroup.current = '';
    editRevision.current++;
    setEditingTaskId(null);
    setEditingDateTaskId(null);
  };
  const titleEditor: InlineEditor = {
    taskId: editingTaskId,
    value: editingTitle,
    onChange: (value) => {
      editRevision.current++;
      setEditingTitle(normalizeTitleInput(value));
    },
    onStart: startInlineEdit,
    onCommit: commitInlineEdit,
    onCancel: cancelEdit,
  };
  const dateEditor: InlineEditor = {
    taskId: editingDateTaskId,
    value: editingDateValue,
    onChange: (value) => {
      editRevision.current++;
      setEditingDateValue(value);
    },
    onStart: startInlineDateEdit,
    onCommit: commitInlineDateEdit,
    onCancel: cancelEdit,
  };
  return { titleEditor, dateEditor, cancelEdit, startInlineEdit };
}
