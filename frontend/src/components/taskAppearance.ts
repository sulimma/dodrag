import type { HighlightRole, TaskState } from '../domain/types';

// Alt shows affected edges, not a destructive card tint. Preserve role precedence across layouts.
export function taskAppearanceRole(
  task: TaskState,
  role: HighlightRole,
  isDropTarget: boolean,
  isAltDrag: boolean
) {
  if (isDropTarget && !isAltDrag) return 'drop';
  if (role === 'selected') return 'selected';
  if (role?.startsWith('predecessor-')) return 'predecessor';
  if (role?.startsWith('successor-')) return 'successor';
  if (task.isActive) return 'active';
  if (task.isDeemphasized) return 'deemphasized';
  return 'default';
}
