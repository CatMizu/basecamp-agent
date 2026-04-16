import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import type { BasecampContext } from './auth-context.js';
import {
  bcFetch,
  bcFetchOffsetLimit,
  bcFetchPage,
  BasecampAuthError,
  BasecampNotFoundError,
  BasecampRateLimitError,
} from './basecamp-api.js';

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

function makeResponse({
  status = 200,
  body,
  headers = {},
}: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headersMap = new Headers(headers);
  return {
    status,
    statusText: 'OK',
    headers: headersMap,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('basecamp-api', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('bcFetch sends User-Agent, Accept and returns parsed body', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ body: { ok: true } }));
    const data = await bcFetch<{ ok: boolean }>(makeCtx(), '/projects.json');
    expect(data.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe('https://3.basecampapi.com/9999/projects.json');
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^BasecampMCP \(/);
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer bearer-token');
  });

  test('bcFetch retries once on 401 with a fresh token', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 401 }));
    fetchMock.mockResolvedValueOnce(makeResponse({ body: { ok: true } }));
    const data = await bcFetch<{ ok: boolean }>(makeCtx(), '/projects.json');
    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('bcFetch throws BasecampAuthError when 401 persists', async () => {
    fetchMock.mockResolvedValue(makeResponse({ status: 401 }));
    await expect(
      bcFetch<unknown>(makeCtx(), '/projects.json'),
    ).rejects.toBeInstanceOf(BasecampAuthError);
  });

  test('bcFetch throws BasecampRateLimitError with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 429, headers: { 'Retry-After': '7' } }),
    );
    const err = await bcFetch<unknown>(makeCtx(), '/projects.json').catch(
      (e) => e as BasecampRateLimitError,
    );
    expect(err).toBeInstanceOf(BasecampRateLimitError);
    expect((err as BasecampRateLimitError).retryAfterSec).toBe(7);
  });

  test('bcFetch throws BasecampNotFoundError on 404', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 404 }));
    await expect(bcFetch<unknown>(makeCtx(), '/x')).rejects.toBeInstanceOf(
      BasecampNotFoundError,
    );
  });

  test('bcFetchPage exposes Link rel="next"', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 1 }],
        headers: {
          Link: '<https://3.basecampapi.com/9999/projects.json?page=2>; rel="next"',
        },
      }),
    );
    const page = await bcFetchPage<Array<{ id: number }>>(makeCtx(), '/projects.json');
    expect(page.nextUrl).toBe(
      'https://3.basecampapi.com/9999/projects.json?page=2',
    );
  });

  test('bcFetchOffsetLimit walks pages to satisfy offset/limit', async () => {
    // Page 1: items 1-3, next page set.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 1 }, { id: 2 }, { id: 3 }],
        headers: {
          Link: '<https://3.basecampapi.com/9999/projects.json?page=2>; rel="next"',
        },
      }),
    );
    // Page 2: items 4-6, no next.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        body: [{ id: 4 }, { id: 5 }, { id: 6 }],
        headers: {},
      }),
    );
    const res = await bcFetchOffsetLimit<{ id: number }>(
      makeCtx(),
      '/projects.json',
      3,
      2,
    );
    // We offset=2, limit=3: skip first 2, take next 3 (items 3,4,5).
    expect(res.items.map((x) => x.id)).toEqual([3, 4, 5]);
    expect(res.hasMore).toBe(true);
  });
});
