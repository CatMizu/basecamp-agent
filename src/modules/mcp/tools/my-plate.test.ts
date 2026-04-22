import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import { handleMyPlate } from './query-tools.js';
import type { MyPlatePayload, MyPlateErrorPayload } from '../../../lib/types.js';

const originalFetch = globalThis.fetch;

function makeCtx(): BasecampContext {
  return {
    identityId: 1,
    accountId: 9999,
    flowId: 'flow-1',
    apiBaseUrl: 'https://3.basecampapi.com/9999',
    getAccessToken: async () => 'bearer-token',
  };
}

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    statusText: 'OK',
    headers: new Headers(headers),
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('handleMyPlate', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('default scope "open" returns grouped MyPlatePayload', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        priorities: [
          {
            id: 1, content: 'Ship auth flow', type: 'Todo', app_url: 'u',
            due_on: '2026-04-22', starts_on: null, completed: false,
            bucket: { id: 10, name: 'Project A', app_url: 'a' },
            parent: { id: 100, title: 'Bugs', app_url: 'l' },
            assignees: [], comments_count: 0, has_description: false,
          },
        ],
        non_priorities: [
          {
            id: 2, content: 'Doc OAuth', type: 'Todo', app_url: 'u2',
            due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'Project A', app_url: 'a' },
            parent: { id: 101, title: 'Docs', app_url: 'l2' },
            assignees: [], comments_count: 1, has_description: false,
          },
        ],
      }),
    );

    const result = await handleMyPlate({}, makeCtx());

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as MyPlatePayload;
    expect(sc.scope).toBe('open');
    expect(sc.priorities).toHaveLength(1);
    expect(sc.priorities[0].id).toBe(1);
    expect(sc.groups).toHaveLength(1);
    expect(sc.groups[0].bucketName).toBe('Project A');
    expect(sc.groups[0].lists).toHaveLength(2);
    const firstContent = result.content?.[0] as { text: string } | undefined;
    expect(firstContent?.text).toMatch(/open.*2 items.*1 priorit/i);
  });

  test('non-todo types are filtered and counted in filteredNonTodoCount', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        priorities: [],
        non_priorities: [
          {
            id: 1, content: 'step', type: 'CardTable::Card::Step',
            app_url: 'u', due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'A', app_url: '' },
            parent: { id: 1, title: 'L', app_url: '' },
            assignees: [], comments_count: 0, has_description: false,
          },
          {
            id: 2, content: 'todo', type: 'Todo',
            app_url: 'u', due_on: null, starts_on: null, completed: false,
            bucket: { id: 10, name: 'A', app_url: '' },
            parent: { id: 1, title: 'L', app_url: '' },
            assignees: [], comments_count: 0, has_description: false,
          },
        ],
      }),
    );
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlatePayload;
    expect(sc.filteredNonTodoCount).toBe(1);
    expect(sc.groups[0].lists[0].todos).toHaveLength(1);
    expect(sc.groups[0].lists[0].todos[0].id).toBe(2);
  });

  test('scope "overdue" hits the due.json endpoint', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse([]));
    await handleMyPlate({ scope: 'overdue' }, makeCtx());
    expect(fetchMock.mock.calls[0][0]).toMatch(/due\.json\?scope=overdue$/);
  });

  test('BasecampApiError renders MyPlateErrorPayload as structuredContent', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'boom' }, 500));
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlateErrorPayload;
    expect(result.isError).toBe(true);
    expect(sc.error).toBeDefined();
    expect(sc.error.message).toMatch(/.+/);
  });

  test('429 surfaces retryAfterSec on the error payload', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: 'rate' }, 429, { 'Retry-After': '30' }),
    );
    const result = await handleMyPlate({}, makeCtx());
    const sc = result.structuredContent as unknown as MyPlateErrorPayload;
    expect(sc.error.retryAfterSec).toBe(30);
  });
});
