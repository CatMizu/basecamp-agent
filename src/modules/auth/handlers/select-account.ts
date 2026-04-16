import { Request, Response } from 'express';
import { logger } from '../../shared/logger.js';
import {
  listAccountsForIdentity,
  readOAuthFlow,
  readPendingAuthorization,
} from '../store/sqlite-store.js';
import { finalizeAuthorization } from './finalize.js';

/**
 * GET /oauth/select-account — renders a tiny HTML form with one radio per
 * bc3 account the identity belongs to.
 */
export function handleSelectAccountGet(req: Request, res: Response): void {
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const flowId = typeof req.query.flow === 'string' ? req.query.flow : undefined;
  if (!state || !flowId) {
    res.status(400).send('Missing state or flow.');
    return;
  }

  const pending = readPendingAuthorization(state);
  const flow = readOAuthFlow(flowId);
  if (!pending || !flow) {
    res.status(400).send('Authorization session expired. Try connecting again.');
    return;
  }

  const accounts = listAccountsForIdentity(flow.identityId).filter(
    (a) => a.product === 'bc3',
  );
  if (accounts.length === 0) {
    res.status(400).send('No Basecamp 3 accounts available for this identity.');
    return;
  }

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  );

  const options = accounts
    .map((a) => {
      const safeName = escapeHtml(a.name);
      return `
        <label class="account">
          <input type="radio" name="account_id" value="${a.accountId}" required>
          <div>
            <div class="account-name">${safeName}</div>
            <div class="account-meta">Account ID: ${a.accountId}</div>
          </div>
        </label>`;
    })
    .join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Select Basecamp account</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="picker">
      <h1>Select a Basecamp account</h1>
      <p>You belong to more than one Basecamp 3 account. Choose the one this connector should use.</p>
      <form method="POST" action="/oauth/select-account">
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <input type="hidden" name="flow" value="${escapeHtml(flowId)}" />
        ${options}
        <button class="btn-primary" type="submit">Continue</button>
      </form>
      <p class="help-text">Connect again to use a different account.</p>
    </main>
  </body>
</html>`);
}

/** POST /oauth/select-account — finalizes the flow. */
export function handleSelectAccountPost(req: Request, res: Response): void {
  const state = typeof req.body.state === 'string' ? req.body.state : undefined;
  const flowId = typeof req.body.flow === 'string' ? req.body.flow : undefined;
  const rawAccountId =
    typeof req.body.account_id === 'string' ? req.body.account_id : undefined;

  if (!state || !flowId || !rawAccountId) {
    res.status(400).send('Missing form fields.');
    return;
  }
  const accountId = Number(rawAccountId);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    res.status(400).send('Invalid account_id.');
    return;
  }

  const pending = readPendingAuthorization(state);
  const flow = readOAuthFlow(flowId);
  if (!pending || !flow) {
    res.status(400).send('Authorization session expired. Try connecting again.');
    return;
  }

  const allowed = listAccountsForIdentity(flow.identityId).filter(
    (a) => a.product === 'bc3' && a.accountId === accountId,
  );
  if (allowed.length === 0) {
    logger.warning('Rejected select-account: account not on identity', {
      identityId: String(flow.identityId),
      accountId: String(accountId),
    });
    res.status(403).send('Selected account is not available for this identity.');
    return;
  }

  finalizeAuthorization(
    { mcpAuthCode: pending.mcpAuthCode, identityId: flow.identityId, accountId, flowId },
    res,
  );
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
