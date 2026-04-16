import { Request, Response } from 'express';
import { generateToken } from '../../../lib/crypto.js';
import { config } from '../../../config.js';
import { logger } from '../../shared/logger.js';
import {
  exchangeCode,
  getAuthorization,
} from '../basecamp/client.js';
import {
  readPendingAuthorization,
  saveOAuthFlow,
  upsertAccounts,
  upsertIdentity,
} from '../store/sqlite-store.js';
import { finalizeAuthorization } from './finalize.js';
import { DEFAULT_BASECAMP_EXPIRES_IN } from '../../../constants.js';

/**
 * Basecamp Launchpad redirects here after the user authorizes. The `state`
 * query param is the mcp_auth_code we generated in provider.authorize().
 */
export async function handleUpstreamCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;

  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  const pending = readPendingAuthorization(state);
  if (!pending) {
    res
      .status(400)
      .send(
        'Authorization request expired or unknown. Close this window and try again.',
      );
    return;
  }

  // 1. Exchange Launchpad code for tokens.
  let tokenRes;
  try {
    tokenRes = await exchangeCode(code);
  } catch (err) {
    logger.error('Basecamp code exchange failed', err as Error);
    res.status(502).send('Basecamp token exchange failed. Please try again.');
    return;
  }

  // 2. Look up identity + accounts.
  let auth;
  try {
    auth = await getAuthorization(tokenRes.access_token);
  } catch (err) {
    logger.error('Launchpad /authorization.json failed', err as Error);
    res.status(502).send('Failed to read Basecamp account list.');
    return;
  }

  // 3. Persist identity + accounts. Filter to bc3 for account selection.
  upsertIdentity({
    identityId: auth.identity.id,
    email: auth.identity.email_address,
    firstName: auth.identity.first_name ?? null,
    lastName: auth.identity.last_name ?? null,
  });
  upsertAccounts(
    auth.identity.id,
    auth.accounts.map((a) => ({
      accountId: a.id,
      name: a.name,
      href: a.href,
      appHref: a.app_href ?? null,
      product: a.product,
    })),
  );

  const bc3 = auth.accounts.filter((a) => a.product === 'bc3');
  if (bc3.length === 0) {
    res
      .status(400)
      .send(
        'No Basecamp 3 accounts found on this Basecamp login. This connector only supports Basecamp 3.',
      );
    return;
  }

  // 4. Record the OAuth flow row — tokens live here, keyed by a random flow_id.
  const expiresIn = tokenRes.expires_in ?? DEFAULT_BASECAMP_EXPIRES_IN;
  const flowExpiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const flowId = generateToken();
  saveOAuthFlow({
    flowId,
    identityId: auth.identity.id,
    accessToken: tokenRes.access_token,
    refreshToken: tokenRes.refresh_token ?? '',
    expiresAt: flowExpiresAt,
    status: 'active',
  });

  // 5. Single vs. multi bc3 account.
  if (bc3.length === 1) {
    finalizeAuthorization(
      {
        mcpAuthCode: pending.mcpAuthCode,
        identityId: auth.identity.id,
        accountId: bc3[0].id,
        flowId,
      },
      res,
    );
    return;
  }

  // >1 — redirect to picker. We stash flowId + state in the URL; the picker
  // page re-posts with the chosen account_id.
  const picker = new URL(`${config.baseUri}/oauth/select-account`);
  picker.searchParams.set('state', pending.mcpAuthCode);
  picker.searchParams.set('flow', flowId);
  res.redirect(picker.toString());
}
