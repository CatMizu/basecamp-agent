import { LAUNCHPAD_URL, REFRESH_BUFFER_SEC, DEFAULT_BASECAMP_EXPIRES_IN } from '../../../constants.js';
import { config } from '../../../config.js';
import { logger } from '../../shared/logger.js';
import {
  readOAuthFlow,
  setOAuthFlowStatus,
  updateOAuthFlowTokens,
} from '../store/sqlite-store.js';
import {
  McpReauthError,
  type BasecampTokenResponse,
} from '../types.js';
import type { BasecampAuthorizationResponse } from '../../../lib/types.js';

function userAgent(): string {
  return `BasecampMCP (${config.userAgentContact})`;
}

/** URL to send the user to for Basecamp authorization. */
export function authorizeUrl(mcpAuthCode: string): string {
  const u = new URL(`${LAUNCHPAD_URL}/authorization/new`);
  u.searchParams.set('type', 'web_server');
  u.searchParams.set('client_id', config.basecamp.clientId);
  u.searchParams.set('redirect_uri', `${config.baseUri}/oauth/basecamp/callback`);
  u.searchParams.set('state', mcpAuthCode);
  return u.toString();
}

/** Exchange the authorization code Launchpad gives us at callback for tokens. */
export async function exchangeCode(code: string): Promise<BasecampTokenResponse> {
  const body = new URLSearchParams({
    type: 'web_server',
    client_id: config.basecamp.clientId,
    client_secret: config.basecamp.clientSecret,
    redirect_uri: `${config.baseUri}/oauth/basecamp/callback`,
    code,
  });
  return postTokenEndpoint(body);
}

export async function refreshToken(refresh: string): Promise<BasecampTokenResponse> {
  const body = new URLSearchParams({
    type: 'refresh',
    client_id: config.basecamp.clientId,
    client_secret: config.basecamp.clientSecret,
    refresh_token: refresh,
  });
  return postTokenEndpoint(body);
}

async function postTokenEndpoint(
  body: URLSearchParams,
): Promise<BasecampTokenResponse> {
  const res = await fetch(`${LAUNCHPAD_URL}/authorization/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent(),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Basecamp token endpoint returned ${res.status}: ${text.substring(0, 500)}`,
    );
  }
  return JSON.parse(text) as BasecampTokenResponse;
}

/** GET /authorization.json on Launchpad — returns identity + accounts. */
export async function getAuthorization(
  accessToken: string,
): Promise<BasecampAuthorizationResponse> {
  const res = await fetch(`${LAUNCHPAD_URL}/authorization.json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': userAgent(),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Launchpad /authorization.json returned ${res.status}: ${text.substring(0, 500)}`,
    );
  }
  return JSON.parse(text) as BasecampAuthorizationResponse;
}

// ─── Auto-refresh with per-flow mutex to prevent thundering-herd ────────

const inflight = new Map<string, Promise<string>>();

/**
 * Returns a valid Basecamp access token for the given flow, refreshing if
 * necessary. Throws McpReauthError if the flow is no longer usable.
 *
 * Concurrent calls for the same flow share a single refresh round-trip via
 * an in-memory mutex.
 */
export async function getBasecampAccessToken(flowId: string): Promise<string> {
  const existing = inflight.get(flowId);
  if (existing) return existing;

  const promise = doGetBasecampAccessToken(flowId).finally(() => {
    inflight.delete(flowId);
  });
  inflight.set(flowId, promise);
  return promise;
}

async function doGetBasecampAccessToken(flowId: string): Promise<string> {
  const flow = readOAuthFlow(flowId);
  if (!flow) {
    throw new McpReauthError('OAuth flow not found');
  }
  if (flow.status !== 'active') {
    throw new McpReauthError(
      `OAuth flow status is "${flow.status}" — reconnect required`,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (flow.expiresAt - REFRESH_BUFFER_SEC > nowSec) {
    return flow.accessToken;
  }

  logger.info('Refreshing Basecamp token', { flowId });
  let tokens: BasecampTokenResponse;
  try {
    tokens = await refreshToken(flow.refreshToken);
  } catch (err) {
    logger.warning('Basecamp refresh failed; marking flow needs_reauth', {
      flowId,
      error: (err as Error).message,
    });
    setOAuthFlowStatus(flowId, 'needs_reauth');
    throw new McpReauthError(
      `Refresh failed for flow ${flowId}: ${(err as Error).message}`,
    );
  }

  const expiresIn = tokens.expires_in ?? DEFAULT_BASECAMP_EXPIRES_IN;
  const newExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  // Basecamp *may* rotate the refresh token on refresh; if not returned,
  // keep the existing one.
  updateOAuthFlowTokens(flowId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? flow.refreshToken,
    expiresAt: newExpiresAt,
  });

  return tokens.access_token;
}
