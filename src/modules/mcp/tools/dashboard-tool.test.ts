import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import { handleDashboard } from './query-tools.js';
import type {
  BasecampMyAssignmentsResponse,
  BasecampReadingsResponse,
  DashboardPayload,
  DashboardErrorPayload,
} from '../../../lib/types.js';

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
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

/** Provide canned responses for the 7 parallel Basecamp calls, keyed by path
 *  substring. Fetches that don't match a key return 404 so misconfigurations
 *  fail loudly. Order-independent — the handler fires them via Promise.all. */
function installFetchRouter(
  fetchMock: jest.MockedFunction<typeof fetch>,
  routes: Record<string, { body?: unknown; status?: number; headers?: Record<string, string> }>,
): void {
  fetchMock.mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    for (const [key, resp] of Object.entries(routes)) {
      if (url.includes(key)) {
        return makeResponse(resp.body, resp.status ?? 200, resp.headers ?? {});
      }
    }
    return makeResponse({ error: 'no route' }, 404);
  });
}

const EMPTY_OPEN: BasecampMyAssignmentsResponse = { priorities: [], non_priorities: [] };
const EMPTY_READINGS: BasecampReadingsResponse = { unreads: [], reads: [], memories: [] };

const HAPPY_ROUTES = {
  'scope=overdue': { body: [] },
  'scope=due_today': { body: [] },
  'scope=due_tomorrow': { body: [] },
  'scope=due_later_this_week': { body: [] },
  'scope=due_next_week': { body: [] },
  '/my/assignments.json': { body: EMPTY_OPEN },
  '/my/readings.json': { body: EMPTY_READINGS },
};

describe('handleDashboard', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns a DashboardPayload shape on the happy path', async () => {
    installFetchRouter(fetchMock, HAPPY_ROUTES);
    const result = await handleDashboard({}, makeCtx());

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as DashboardPayload;
    expect(sc.kpi).toBeDefined();
    expect(sc.kpi.overdue.count).toBe(0);
    expect(sc.upcoming).toHaveLength(7);
    expect(Array.isArray(sc.today)).toBe(true);
    expect(Array.isArray(sc.projects)).toBe(true);
    expect(Array.isArray(sc.waitingOnYou)).toBe(true);
    const textBlock = result.content?.[0] as { text: string } | undefined;
    expect(textBlock?.text).toMatch(/overdue.*due today.*unread.*waiting/);
  });

  test('ignores any args passed (forward-compat with older prompts)', async () => {
    installFetchRouter(fetchMock, HAPPY_ROUTES);
    const result = await handleDashboard({ scope: 'overdue', random: 'junk' }, makeCtx());
    expect(result.isError).toBeFalsy();
  });

  test('fans out to all 7 Basecamp endpoints', async () => {
    installFetchRouter(fetchMock, HAPPY_ROUTES);
    await handleDashboard({}, makeCtx());
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('scope=overdue'))).toBe(true);
    expect(urls.some((u) => u.includes('scope=due_today'))).toBe(true);
    expect(urls.some((u) => u.includes('scope=due_tomorrow'))).toBe(true);
    expect(urls.some((u) => u.includes('scope=due_later_this_week'))).toBe(true);
    expect(urls.some((u) => u.includes('scope=due_next_week'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/my/assignments.json'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/my/readings.json'))).toBe(true);
  });

  test('any sub-call failure degrades to DashboardErrorPayload (isError=true)', async () => {
    // /my/readings.json returns 500, everything else succeeds.
    installFetchRouter(fetchMock, {
      ...HAPPY_ROUTES,
      '/my/readings.json': { body: { error: 'boom' }, status: 500 },
    });
    const result = await handleDashboard({}, makeCtx());
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as unknown as DashboardErrorPayload;
    expect(sc.error.message).toMatch(/.+/);
  });

  test('429 on any sub-call surfaces retryAfterSec on the error payload', async () => {
    installFetchRouter(fetchMock, {
      ...HAPPY_ROUTES,
      'scope=overdue': { body: { error: 'rate' }, status: 429, headers: { 'Retry-After': '42' } },
    });
    const result = await handleDashboard({}, makeCtx());
    const sc = result.structuredContent as unknown as DashboardErrorPayload;
    expect(sc.error.retryAfterSec).toBe(42);
  });
});
