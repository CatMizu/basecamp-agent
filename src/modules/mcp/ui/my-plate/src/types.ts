import type { MyPlateScope } from '../../../../../lib/types.js';

export interface RenderCallbacks {
  onScopeChange: (next: MyPlateScope) => void;
  onCompleteTodo: (projectId: number, todoId: number) => void;
}

export type ScopeTabId = MyPlateScope;

export const SCOPE_TABS: Array<{ id: ScopeTabId; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'due_today', label: 'Today' },
  { id: 'due_tomorrow', label: 'Tomorrow' },
  { id: 'due_later_this_week', label: 'This week' },
  { id: 'due_next_week', label: 'Next week' },
  { id: 'due_later', label: 'Later' },
  { id: 'completed', label: 'Completed' },
];
