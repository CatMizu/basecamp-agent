import { Response } from 'express';
import { generateToken } from '../../../lib/crypto.js';
import { ACCESS_TOKEN_EXPIRY_SEC } from '../provider.js';
import {
  readPendingAuthorization,
  saveMcpInstallation,
  saveTokenExchange,
} from '../store/sqlite-store.js';
import { logger } from '../../shared/logger.js';

export interface FinalizeInput {
  mcpAuthCode: string;
  identityId: number;
  accountId: number;
  flowId: string;
}

/**
 * Finalize the OAuth dance: create the MCP installation, record the
 * token_exchanges entry, and redirect the browser back to the client's
 * redirect_uri with the auth code.
 *
 * Called from both the single-bc3-account auto-select path (upstream
 * callback) and the multi-account picker POST.
 */
export function finalizeAuthorization(input: FinalizeInput, res: Response): void {
  const pending = readPendingAuthorization(input.mcpAuthCode);
  if (!pending) {
    res
      .status(400)
      .send(
        'Authorization request expired. Close this window and try connecting again.',
      );
    return;
  }

  const mcpAccessToken = generateToken();
  const mcpRefreshToken = generateToken();
  const nowSec = Math.floor(Date.now() / 1000);

  saveMcpInstallation({
    accessToken: mcpAccessToken,
    refreshToken: mcpRefreshToken,
    clientId: pending.clientId,
    identityId: input.identityId,
    accountId: input.accountId,
    flowId: input.flowId,
    expiresAt: nowSec + ACCESS_TOKEN_EXPIRY_SEC,
  });
  saveTokenExchange(input.mcpAuthCode, mcpAccessToken);

  // Note: we do NOT delete the pending_authorizations row here — the SDK's
  // tokenHandler calls provider.challengeForAuthorizationCode() first, which
  // reads the pending row for the codeChallenge. exchangeAuthorizationCode()
  // deletes it after a successful exchange.

  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set('code', input.mcpAuthCode);
  if (pending.clientState) {
    redirect.searchParams.set('state', pending.clientState);
  }
  logger.info('Finalized MCP authorization', {
    clientId: pending.clientId,
    identityId: String(input.identityId),
    accountId: String(input.accountId),
  });
  res.redirect(redirect.toString());
}
