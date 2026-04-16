import { Response } from 'express';
import {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidTokenError,
  InvalidGrantError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { generateToken } from '../../lib/crypto.js';
import { logger } from '../shared/logger.js';
import { authorizeUrl } from './basecamp/client.js';
import {
  consumeTokenExchange,
  deletePendingAuthorization,
  getClient,
  readMcpInstallationByAccess,
  readMcpInstallationByRefresh,
  readPendingAuthorization,
  revokeMcpInstallation,
  rotateMcpInstallationTokens,
  saveClient,
  savePendingAuthorization,
} from './store/sqlite-store.js';

/** 30 days — matches CallAgent default. */
export const ACCESS_TOKEN_EXPIRY_SEC = 30 * 24 * 60 * 60;

class SqliteClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return getClient(clientId);
  }
  async registerClient(
    client: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    saveClient(client);
    return client;
  }
}

export class BasecampOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new SqliteClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const mcpAuthCode = generateToken();
    savePendingAuthorization({
      mcpAuthCode,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      clientState: params.state ?? null,
    });
    logger.debug('Saved pending authorization', {
      mcpAuthCode: mcpAuthCode.substring(0, 8) + '...',
      clientId: client.client_id,
    });
    res.redirect(authorizeUrl(mcpAuthCode));
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    // By the time the client reaches /token, we've already finalized the
    // flow and deleted the pending_authorizations row. The code_challenge
    // that matters at this point lives on the token_exchanges row (indirectly
    // — the finalize step preserves it so the SDK's PKCE check still runs).
    //
    // We stash the challenge on the mcp_installation so it survives the
    // pending row deletion. But to avoid an extra DB column in v1, we keep
    // the pending row alive until the /token call (the finalize step does
    // NOT delete it). The exchange step below handles the cleanup.
    const pending = readPendingAuthorization(authorizationCode);
    if (!pending) {
      throw new InvalidGrantError('Authorization code not found or expired');
    }
    if (pending.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code does not match client');
    }
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const result = consumeTokenExchange(authorizationCode);
    if (!result) {
      throw new InvalidGrantError('Authorization code not found or expired');
    }
    if (!result.firstUse) {
      // Replay attempt — revoke the issued install.
      logger.error('Replay of authorization code detected; revoking installation', undefined, {
        mcpAuthCode: authorizationCode.substring(0, 8) + '...',
      });
      revokeMcpInstallation(result.exchange.mcpAccessToken);
      throw new InvalidGrantError('Authorization code already used');
    }

    const install = readMcpInstallationByAccess(result.exchange.mcpAccessToken);
    if (!install) {
      throw new ServerError('Installation lookup failed');
    }
    if (install.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code does not match client');
    }

    // Now that the code has been consumed, clean up pending state.
    deletePendingAuthorization(authorizationCode);

    const issued = {
      access_token: install.accessToken,
      refresh_token: install.refreshToken,
      expires_in: install.expiresAt
        ? Math.max(0, install.expiresAt - Math.floor(Date.now() / 1000))
        : ACCESS_TOKEN_EXPIRY_SEC,
      token_type: 'Bearer',
    } satisfies OAuthTokens;
    return issued;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const install = readMcpInstallationByRefresh(refreshToken);
    if (!install || install.revokedAt) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    if (install.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid client');
    }

    const newAccess = generateToken();
    const newRefresh = generateToken();
    const newExpiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY_SEC;
    const rotated = rotateMcpInstallationTokens(install.accessToken, {
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt: newExpiresAt,
    });
    if (!rotated) {
      throw new ServerError('Token rotation failed');
    }

    return {
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_in: ACCESS_TOKEN_EXPIRY_SEC,
      token_type: 'Bearer',
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const install = readMcpInstallationByAccess(token);
    if (!install || install.revokedAt) {
      throw new InvalidTokenError('Invalid access token');
    }
    if (install.expiresAt && install.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError('Token has expired');
    }

    return {
      token,
      clientId: install.clientId,
      scopes: ['mcp'],
      expiresAt: install.expiresAt ?? undefined,
      extra: {
        userId: String(install.identityId),
        identityId: install.identityId,
        accountId: install.accountId,
        flowId: install.flowId,
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // The SDK lets the caller revoke either an access or refresh token.
    // Try both lookup strategies; no-op if neither matches.
    const byAccess = readMcpInstallationByAccess(request.token);
    if (byAccess) {
      revokeMcpInstallation(byAccess.accessToken);
      return;
    }
    const byRefresh = readMcpInstallationByRefresh(request.token);
    if (byRefresh) {
      revokeMcpInstallation(byRefresh.accessToken);
    }
  }
}
