import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** Fields cached from Basecamp Launchpad's /authorization.json for one identity. */
export interface BasecampIdentityRecord {
  identityId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BasecampAccountRecord {
  identityId: number;
  accountId: number;
  name: string;
  href: string;
  appHref: string | null;
  product: string;
  cachedAt: number;
}

export type BasecampFlowStatus = 'active' | 'needs_reauth' | 'revoked';

/** One row per Launchpad OAuth grant. Tokens live here. */
export interface BasecampOAuthFlow {
  flowId: string;
  identityId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  status: BasecampFlowStatus;
  createdAt: number;
  updatedAt: number;
}

/** In-flight /authorize request state. Keyed by mcp_auth_code. TTL 10min. */
export interface PendingAuthorization {
  mcpAuthCode: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientState: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface McpInstallation {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  identityId: number;
  accountId: number;
  flowId: string;
  issuedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

/** Replay-protection record for /token exchange. */
export interface TokenExchange {
  mcpAuthCode: string;
  mcpAccessToken: string;
  alreadyUsed: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface RegisteredOAuthClient {
  clientId: string;
  clientName: string | null;
  metadata: OAuthClientInformationFull;
  createdAt: number;
  expiresAt: number;
}

/** Raw token response from POST launchpad/authorization/token */
export interface BasecampTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Thrown by getBasecampAccessToken when the flow's refresh token no longer
 * works. Surfaced as a 401 + a tool response telling the user to reconnect.
 */
export class McpReauthError extends Error {
  constructor(message = 'Basecamp connector needs to be reconnected') {
    super(message);
    this.name = 'McpReauthError';
  }
}
