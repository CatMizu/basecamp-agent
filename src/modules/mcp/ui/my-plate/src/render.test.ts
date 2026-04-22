/** @jest-environment jsdom */
import { describe, test, expect, jest } from '@jest/globals';
import { render } from './render.js';
import type { RenderCallbacks } from './types.js';
import type { MyPlatePayload, MyPlateErrorPayload } from '../../../../../lib/types.js';

function makeCallbacks(): RenderCallbacks {
  return {
    onScopeChange: jest.fn(),
    onCompleteTodo: jest.fn(),
  };
}

function makePayload(overrides: Partial<MyPlatePayload> = {}): MyPlatePayload {
  return {
    scope: 'open',
    priorities: [],
    groups: [],
    filteredNonTodoCount: 0,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('render', () => {
  test('renders empty state when no todos', () => {
    const root = document.createElement('div');
    render(root, makePayload(), makeCallbacks());
    expect(root.textContent).toMatch(/caught up|nothing on your plate|empty/i);
  });

  test('renders priorities section at the top with a priority star', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        priorities: [
          {
            id: 1,
            type: 'Todo',
            content: 'Ship it',
            dueOn: '2026-04-22',
            completed: false,
            priority: true,
            commentsCount: 0,
            appUrl: 'u',
            assignees: [],
            projectId: 10,
          },
        ],
      }),
      makeCallbacks(),
    );
    const prio = root.querySelector('[data-section="priorities"]');
    expect(prio).not.toBeNull();
    expect(prio!.textContent).toContain('Ship it');
  });

  test('renders one group section per project with nested lists and todos', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 10,
            bucketName: 'Project A',
            appUrl: '',
            lists: [
              {
                listId: 1,
                title: 'Bugs',
                appUrl: '',
                todos: [
                  {
                    id: 1,
                    type: 'Todo',
                    content: 'Fix login',
                    dueOn: null,
                    completed: false,
                    priority: false,
                    commentsCount: 0,
                    appUrl: 'u',
                    assignees: [],
                    projectId: 10,
                  },
                ],
              },
            ],
          },
        ],
      }),
      makeCallbacks(),
    );
    const groups = root.querySelectorAll('[data-section="group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('Project A');
    expect(groups[0].textContent).toContain('Bugs');
    expect(groups[0].textContent).toContain('Fix login');
  });

  test('clicking a checkbox invokes onCompleteTodo with (projectId, todoId)', () => {
    const root = document.createElement('div');
    const cbs = makeCallbacks();
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 10,
            bucketName: 'A',
            appUrl: '',
            lists: [
              {
                listId: 1,
                title: 'L',
                appUrl: '',
                todos: [
                  {
                    id: 42,
                    type: 'Todo',
                    content: 'do',
                    dueOn: null,
                    completed: false,
                    priority: false,
                    commentsCount: 0,
                    appUrl: '',
                    assignees: [],
                    projectId: 10,
                  },
                ],
              },
            ],
          },
        ],
      }),
      cbs,
    );
    const box = root.querySelector<HTMLInputElement>('input[type="checkbox"][data-todo-id="42"]');
    expect(box).not.toBeNull();
    box!.click();
    expect(cbs.onCompleteTodo).toHaveBeenCalledWith(10, 42);
  });

  test('clicking a scope tab invokes onScopeChange', () => {
    const root = document.createElement('div');
    const cbs = makeCallbacks();
    render(root, makePayload(), cbs);
    const tab = root.querySelector<HTMLElement>('[data-scope-tab="overdue"]');
    expect(tab).not.toBeNull();
    tab!.click();
    expect(cbs.onScopeChange).toHaveBeenCalledWith('overdue');
  });

  test('error payload renders error card, no todo list', () => {
    const root = document.createElement('div');
    const err: MyPlateErrorPayload = {
      scope: 'open',
      error: { message: 'Basecamp rate limit hit.', retryAfterSec: 30 },
      fetchedAt: new Date().toISOString(),
    };
    render(root, err, makeCallbacks());
    expect(root.querySelector('[data-section="error"]')).not.toBeNull();
    expect(root.textContent).toContain('Basecamp rate limit hit.');
    expect(root.textContent).toContain('30');
    expect(root.querySelectorAll('[data-section="group"]')).toHaveLength(0);
  });

  test('active scope tab has aria-current="page"', () => {
    const root = document.createElement('div');
    render(root, makePayload({ scope: 'completed' }), makeCallbacks());
    const active = root.querySelector('[data-scope-tab="completed"]');
    expect(active?.getAttribute('aria-current')).toBe('page');
  });

  test('escapes HTML special chars in todo content (no live <script>)', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 1, bucketName: 'A', appUrl: '',
            lists: [{
              listId: 1, title: 'L', appUrl: '',
              todos: [{
                id: 1, type: 'Todo', content: '<script>alert(1)</script>',
                dueOn: null, completed: false, priority: false,
                commentsCount: 0, appUrl: 'https://3.basecamp.com/x',
                assignees: [], projectId: 1,
              }],
            }],
          },
        ],
      }),
      makeCallbacks(),
    );
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  test('neuters non-http(s) hrefs (e.g. javascript:)', () => {
    const root = document.createElement('div');
    render(
      root,
      makePayload({
        groups: [
          {
            bucketId: 1, bucketName: 'A', appUrl: '',
            lists: [{
              listId: 1, title: 'L', appUrl: '',
              todos: [{
                id: 1, type: 'Todo', content: 'x',
                dueOn: null, completed: false, priority: false,
                commentsCount: 0, appUrl: 'javascript:alert(1)',
                assignees: [], projectId: 1,
              }],
            }],
          },
        ],
      }),
      makeCallbacks(),
    );
    const link = root.querySelector<HTMLAnchorElement>('a.todo-content');
    expect(link?.getAttribute('href')).toBe('#');
  });

  test('second render replaces first render output', () => {
    const root = document.createElement('div');
    render(root, makePayload({ scope: 'open' }), makeCallbacks());
    render(root, makePayload({ scope: 'overdue' }), makeCallbacks());
    const activeOverdue = root.querySelector('[data-scope-tab="overdue"]');
    const openTab = root.querySelector('[data-scope-tab="open"]');
    expect(activeOverdue?.getAttribute('aria-current')).toBe('page');
    expect(openTab?.getAttribute('aria-current')).toBeNull();
  });
});
