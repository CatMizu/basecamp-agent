import type {
  MyPlatePayload,
  MyPlateErrorPayload,
  NormalizedTodo,
  NormalizedGroup,
  NormalizedList,
  MyPlateScope,
} from '../../../../../lib/types.js';
import type { RenderCallbacks } from './types.js';
import { SCOPE_TABS } from './types.js';

type Payload = MyPlatePayload | MyPlateErrorPayload;

function isError(p: Payload): p is MyPlateErrorPayload {
  return 'error' in p;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function dueChip(dueOn: string | null): string {
  if (!dueOn) return '';
  // Compare calendar dates in local time: snap `today` to local midnight and
  // parse the due-date string as local midnight (no `Z` → no UTC coercion).
  // Using UTC on one side and wall-clock `new Date()` on the other would make
  // today's items show "Overdue" for users west of UTC all business day.
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueOn + 'T00:00:00');
  const msDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((due.getTime() - todayMidnight.getTime()) / msDay);
  let cls = 'chip chip-due';
  let label = dueOn;
  if (diff < 0) {
    cls += ' chip-overdue';
    label = `Overdue · ${dueOn}`;
  } else if (diff === 0) {
    cls += ' chip-today';
    label = 'Today';
  } else if (diff <= 7) {
    cls += ' chip-soon';
    label = dueOn;
  }
  return `<span class="${cls}">${escape(label)}</span>`;
}

function safeHref(url: string): string {
  // Only pass http(s) through; otherwise render a neutered # link. Basecamp's
  // API returns https URLs today, but don't trust that at the render boundary.
  return /^https?:/i.test(url) ? escape(url) : '#';
}

function renderTodo(t: NormalizedTodo): string {
  const priorityStar = t.priority ? '<span class="star" title="Priority">★</span>' : '';
  const due = dueChip(t.dueOn);
  const comments =
    t.commentsCount > 0
      ? `<span class="chip chip-comments" title="${t.commentsCount} comments">💬 ${t.commentsCount}</span>`
      : '';
  return `
    <div class="todo" data-todo-id="${t.id}" data-project-id="${t.projectId}">
      <input type="checkbox" data-todo-id="${t.id}" data-project-id="${t.projectId}"
        ${t.completed ? 'checked disabled' : ''} aria-label="Complete ${escape(t.content)}" />
      ${priorityStar}
      <a class="todo-content" href="${safeHref(t.appUrl)}" target="_blank" rel="noreferrer">
        ${escape(t.content)}
      </a>
      <span class="todo-meta">${due}${comments}</span>
    </div>`;
}

function renderList(l: NormalizedList): string {
  const header = `<div class="list-header">${escape(l.title)}</div>`;
  const body = l.todos.map(renderTodo).join('');
  return `<div class="list">${header}${body}</div>`;
}

function renderGroup(g: NormalizedGroup): string {
  const header = `<div class="group-header">${escape(g.bucketName)}</div>`;
  const lists = g.lists.map(renderList).join('');
  return `<div class="group" data-section="group">${header}${lists}</div>`;
}

function renderTabs(scope: MyPlateScope): string {
  return `<nav class="tabs">
    ${SCOPE_TABS.map(
      (t) =>
        `<button type="button" class="tab" data-scope-tab="${t.id}"
          ${t.id === scope ? 'aria-current="page"' : ''}>${escape(t.label)}</button>`,
    ).join('')}
  </nav>`;
}

function renderEmpty(scope: MyPlateScope): string {
  return `<div class="empty" data-section="empty">
    All caught up — nothing on your plate for scope <strong>${escape(scope)}</strong>.
  </div>`;
}

function renderError(p: MyPlateErrorPayload): string {
  const retry =
    p.error.retryAfterSec !== undefined
      ? ` (retry in ${p.error.retryAfterSec}s)`
      : '';
  return `<div class="error-card" data-section="error" role="alert">
    <strong>Something broke.</strong> ${escape(p.error.message)}${escape(retry)}
  </div>`;
}

/**
 * Paint the my-plate UI into `root`. Clears existing content.
 * Callbacks dispatch user intents — no tool calls happen here.
 */
export function render(
  root: HTMLElement,
  payload: Payload,
  callbacks: RenderCallbacks,
): void {
  if (isError(payload)) {
    root.innerHTML = renderTabs(payload.scope) + renderError(payload);
    wireTabs(root, callbacks);
    return;
  }

  const prioritiesSection =
    payload.priorities.length > 0
      ? `<div class="priorities" data-section="priorities">
          <div class="group-header">★ Priorities</div>
          ${payload.priorities.map(renderTodo).join('')}
        </div>`
      : '';

  const groupsHtml =
    payload.groups.length > 0 ? payload.groups.map(renderGroup).join('') : '';

  const noContent = payload.priorities.length === 0 && payload.groups.length === 0;

  root.innerHTML =
    renderTabs(payload.scope) +
    (noContent
      ? renderEmpty(payload.scope)
      : prioritiesSection + groupsHtml);

  wireTabs(root, callbacks);
  wireCheckboxes(root, callbacks);
}

function wireTabs(root: HTMLElement, callbacks: RenderCallbacks): void {
  root.querySelectorAll<HTMLButtonElement>('[data-scope-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const scope = el.dataset.scopeTab;
      if (scope) callbacks.onScopeChange(scope as MyPlateScope);
    });
  });
}

function wireCheckboxes(root: HTMLElement, callbacks: RenderCallbacks): void {
  root
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-todo-id]')
    .forEach((el) => {
      el.addEventListener('click', () => {
        const todoId = Number(el.dataset.todoId);
        const projectId = Number(el.dataset.projectId);
        if (Number.isFinite(todoId) && Number.isFinite(projectId)) {
          callbacks.onCompleteTodo(projectId, todoId);
        }
      });
    });
}
