import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getBasecampAccessToken } from '../../auth/basecamp/client.js';
import { API_BASE_URL_PREFIX } from '../../../constants.js';

/** Extracted from AuthInfo.extra by the MCP SDK's bearerAuth middleware. */
export interface BasecampContext {
  identityId: number;
  accountId: number;
  flowId: string;
  /** Base URL for per-account Basecamp API: https://3.basecampapi.com/{account_id} */
  apiBaseUrl: string;
  /** Fetches a valid access token, auto-refreshing if necessary. */
  getAccessToken(): Promise<string>;
}

/**
 * Pulls the Basecamp context out of `extra` (populated in
 * BasecampOAuthProvider.verifyAccessToken). Throws if the bearer token wasn't
 * an MCP installation — shouldn't happen if the middleware ran.
 */
export function getBasecampCtx(extra: AuthInfo['extra']): BasecampContext {
  if (!extra) throw new Error('Missing auth context');
  const identityId = Number(extra.identityId);
  const accountId = Number(extra.accountId);
  const flowId = String(extra.flowId);
  if (!Number.isFinite(accountId) || !Number.isFinite(identityId) || !flowId) {
    throw new Error('Invalid auth context');
  }
  return {
    identityId,
    accountId,
    flowId,
    apiBaseUrl: `${API_BASE_URL_PREFIX}/${accountId}`,
    async getAccessToken() {
      return getBasecampAccessToken(flowId);
    },
  };
}
