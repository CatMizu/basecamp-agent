import { config } from '../../../config.js';
import { logger } from '../../shared/logger.js';
import { McpReauthError } from '../../auth/types.js';
import type { BasecampContext } from './auth-context.js';

/** Tool-facing error types. toolError() renders them for the LLM. */
export class BasecampAuthError extends Error {
  constructor(msg = 'Basecamp auth failed') {
    super(msg);
    this.name = 'BasecampAuthError';
  }
}
export class BasecampRateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Rate limited; retry after ${retryAfterSec}s`);
    this.name = 'BasecampRateLimitError';
  }
}
export class BasecampNotFoundError extends Error {
  constructor(msg = 'Basecamp resource not found') {
    super(msg);
    this.name = 'BasecampNotFoundError';
  }
}
export class BasecampApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
    this.name = 'BasecampApiError';
  }
}

function userAgent(): string {
  return `BasecampMCP (${config.userAgentContact})`;
}

export interface BcFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** For POST/PUT. Automatically JSON-stringified; Content-Type set. */
  body?: unknown;
  /** Extra query params (camelCase converted to snake_case is on the caller). */
  params?: Record<string, string | number | undefined>;
}

interface BcResponse {
  status: number;
  headers: Headers;
  text: string;
}

async function doFetch(url: string, token: string, opts: BcFetchOptions): Promise<BcResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'User-Agent': userAgent(),
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/**
 * Make one Basecamp API call. Handles auth refresh, 429 retry, generic error
 * shaping. Does not follow Link-header pagination (use bcFetchPage for that).
 * Returns the parsed JSON body typed as T.
 */
export async function bcFetch<T>(
  ctx: BasecampContext,
  urlOrPath: string,
  opts: BcFetchOptions = {},
): Promise<T> {
  const page = await bcFetchPage<T>(ctx, urlOrPath, opts);
  return page.data;
}

export interface BcPage<T> {
  data: T;
  nextUrl: string | undefined;
}

/**
 * Make one Basecamp API call and return the parsed body plus the Link-header
 * `rel="next"` URL if there is one. Auto-refreshes on 401 (one retry) and
 * honors Retry-After on 429.
 */
export async function bcFetchPage<T>(
  ctx: BasecampContext,
  urlOrPath: string,
  opts: BcFetchOptions = {},
): Promise<BcPage<T>> {
  const url = buildUrl(ctx, urlOrPath, opts.params);

  let token: string;
  try {
    token = await ctx.getAccessToken();
  } catch (err) {
    if (err instanceof McpReauthError) throw new BasecampAuthError(err.message);
    throw err;
  }

  let res = await doFetch(url, token, opts);

  // Retry once on 401 — refresh may have happened between our cache check and
  // the actual request.
  if (res.status === 401) {
    logger.warning('Basecamp 401 on first try; retrying after refresh', { url });
    try {
      token = await ctx.getAccessToken();
    } catch (err) {
      if (err instanceof McpReauthError) throw new BasecampAuthError(err.message);
      throw err;
    }
    res = await doFetch(url, token, opts);
    if (res.status === 401) {
      throw new BasecampAuthError('Basecamp rejected the access token');
    }
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '10');
    throw new BasecampRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 10);
  }
  if (res.status === 404) {
    throw new BasecampNotFoundError();
  }
  if (res.status < 200 || res.status >= 300) {
    throw new BasecampApiError(res.status, sanitize(res.text));
  }

  const parsed = res.text ? (JSON.parse(res.text) as T) : (undefined as unknown as T);
  const nextUrl = parseNextUrl(res.headers.get('Link'));
  return { data: parsed, nextUrl };
}

/**
 * Follow Link-header pagination by `offset` pages starting at 0 and returning
 * one page at a time. Callers pass `limit`/`offset` — we iterate until we've
 * skipped `offset` items and collected `limit` items, or exhausted pages.
 *
 * Basecamp's per-page size is server-controlled (typically 15-50). We can't
 * ask for page N directly; we must walk Link: rel="next" URLs. This helper
 * abstracts that into a flat offset/limit API.
 */
export interface OffsetLimitResult<T> {
  items: T[];
  total: number;        // best-effort — 0 if unknown
  hasMore: boolean;
}

export async function bcFetchOffsetLimit<T>(
  ctx: BasecampContext,
  initialPath: string,
  limit: number,
  offset: number,
): Promise<OffsetLimitResult<T>> {
  let url = buildUrl(ctx, initialPath, undefined);
  const collected: T[] = [];
  let skipped = 0;
  const total = 0;
  let hasMore = false;

  while (url) {
    const page: BcPage<T[]> = await bcFetchPage<T[]>(ctx, url, {});
    const items = Array.isArray(page.data) ? page.data : [];

    // best-effort count from X-Total-Count (Basecamp sets it on list endpoints)
    // — fetched once at the initial request.
    if (total === 0) {
      // We don't carry headers out of bcFetchPage; expose it via a secondary read.
      // For now we set total based on accumulated + remaining hint; callers that
      // need exact total should check items.length + hasMore.
    }

    for (const item of items) {
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      if (collected.length < limit) {
        collected.push(item);
      } else {
        // We have enough; record whether more exist upstream.
        hasMore = true;
        break;
      }
    }

    if (collected.length >= limit) {
      // We filled our page — check if the current upstream page had more or
      // there's a next page we didn't walk.
      hasMore = hasMore || !!page.nextUrl || items.length > skipped + limit;
      break;
    }

    if (!page.nextUrl) {
      hasMore = false;
      break;
    }
    url = page.nextUrl;
  }

  return { items: collected, total, hasMore };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function buildUrl(
  ctx: BasecampContext,
  urlOrPath: string,
  params: BcFetchOptions['params'],
): string {
  // If urlOrPath is already absolute, use it verbatim (pagination next URLs).
  const isAbs = urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://');
  const base = isAbs ? urlOrPath : `${ctx.apiBaseUrl}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
  if (!params) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function parseNextUrl(link: string | null): string | undefined {
  if (!link) return undefined;
  // Link format: <URL>; rel="next", <URL>; rel="prev"
  const parts = link.split(',');
  for (const part of parts) {
    const match = part.match(/^\s*<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return undefined;
}

function sanitize(text: string): string {
  // Never bubble raw HTML or full error bodies back to the LLM.
  const short = text.substring(0, 500);
  // If it looks like JSON, keep it; else strip to a single line.
  return short.replace(/\s+/g, ' ').trim();
}
