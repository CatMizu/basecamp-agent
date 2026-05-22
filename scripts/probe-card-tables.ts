#!/usr/bin/env tsx
/**
 * One-shot probe of the Basecamp Card Tables ("kanban") API. Dumps raw JSON
 * for every endpoint we plan to wrap with `basecamp_*_ticket` tools so we can
 * verify shapes before writing tool code.
 *
 * Independent of the auth/vault stack on purpose: takes a bearer token on the
 * command line and uses raw `globalThis.fetch`. No bcFetch, no DB.
 *
 * Usage:
 *   npx tsx scripts/probe-card-tables.ts \
 *     --token <bearer> \
 *     --account 5946961 \
 *     --bucket 43253466 \
 *     --card-table 8895714077
 *
 * Side effects: creates one card titled
 *   "[probe] mcp-server feasibility test — safe to delete"
 * in the first column of the target card_table, moves it, updates it, then
 * tries to trash it. If the trash step fails, you'll need to delete the
 * probe card from the Basecamp UI manually.
 */

interface Args {
  token: string;
  account: string;
  bucket: string;
  cardTable: string;
}

function parseArgs(): Args {
  const out: Partial<Args> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--token':
        out.token = v;
        i++;
        break;
      case '--account':
        out.account = v;
        i++;
        break;
      case '--bucket':
        out.bucket = v;
        i++;
        break;
      case '--card-table':
        out.cardTable = v;
        i++;
        break;
      case '--help':
      case '-h':
        printUsageAndExit(0);
    }
  }
  if (!out.token || !out.account || !out.bucket || !out.cardTable) {
    printUsageAndExit(2);
  }
  return out as Args;
}

function printUsageAndExit(code: number): never {
  const msg = [
    'Usage:',
    '  npx tsx scripts/probe-card-tables.ts \\',
    '    --token <bearer> \\',
    '    --account <account-id> \\',
    '    --bucket <project-id> \\',
    '    --card-table <card-table-id>',
    '',
    'Reads USER_AGENT_CONTACT from env for the User-Agent header.',
  ].join('\n');
  if (code === 0) console.log(msg);
  else console.error(msg);
  process.exit(code);
}

const args = parseArgs();
const apiBase = `https://3.basecampapi.com/${args.account}`;
const userAgent = `BasecampMCP (${process.env.USER_AGENT_CONTACT ?? 'probe-script'})`;

console.log(`Probing account=${args.account} bucket=${args.bucket} card_table=${args.cardTable}`);
console.log(`Token prefix:  ${args.token.substring(0, 8)}…  (full token never logged)`);
console.log(`User-Agent:    ${userAgent}`);
console.log('');

interface FetchResult {
  status: number;
  link: string | null;
  retryAfter: string | null;
  body: unknown;
  rawSnippet: string;
}

async function call(method: string, path: string, body?: unknown): Promise<FetchResult> {
  const url = path.startsWith('http') ? path : `${apiBase}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
    'User-Agent': userAgent,
    Accept: 'application/json',
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  return {
    status: res.status,
    link: res.headers.get('Link'),
    retryAfter: res.headers.get('Retry-After'),
    body: parsed,
    rawSnippet: raw.substring(0, 500),
  };
}

function step(n: number, desc: string): void {
  console.log(`=== STEP ${n}: ${desc} ===`);
}

function dump(result: FetchResult): void {
  console.log(`  HTTP ${result.status}`);
  if (result.link) console.log(`  Link: ${result.link}`);
  if (result.retryAfter) console.log(`  Retry-After: ${result.retryAfter}`);
  console.log(JSON.stringify(result.body, null, 2));
  console.log('');
}

function abortOnAuthOrLimit(result: FetchResult, stepName: string): void {
  if (result.status === 401) {
    console.error(`Aborting: ${stepName} returned 401.`);
    console.error('  → token is likely expired, revoked, or scoped to a different account.');
    console.error(`  → response body snippet: ${result.rawSnippet}`);
    process.exit(1);
  }
  if (result.status === 429) {
    console.error(`Aborting: ${stepName} returned 429.`);
    console.error(`  → Retry-After: ${result.retryAfter ?? 'not set'} sec`);
    console.error('  → wait and re-run; this is a probe, we don’t retry.');
    process.exit(1);
  }
}

interface ColumnLike {
  id: number;
  title?: string;
  type?: string;
}

function extractColumns(body: unknown): ColumnLike[] {
  if (!body || typeof body !== 'object') return [];
  // Basecamp's card_table response is expected to have a `lists` array of
  // column objects. If the shape turns out to be different (e.g. `columns`),
  // STEP 2's dump will reveal it and we update the tool accordingly.
  const lists = (body as { lists?: unknown }).lists;
  if (!Array.isArray(lists)) return [];
  return lists.filter(
    (c): c is ColumnLike => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'number',
  );
}

function extractFirstCardId(body: unknown): number | null {
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0];
    if (first && typeof first === 'object' && typeof (first as { id?: unknown }).id === 'number') {
      return (first as { id: number }).id;
    }
  }
  return null;
}

async function main(): Promise<void> {
  // STEP 1: project dock — does card_table show up as a dock entry?
  step(1, 'GET /projects/{bucket}.json (look for card_table in dock)');
  const projectRes = await call('GET', `/projects/${args.bucket}.json`);
  abortOnAuthOrLimit(projectRes, 'GET project');
  dump(projectRes);

  // STEP 2: card table structure
  step(2, 'GET /buckets/{bucket}/card_tables/{card_table}.json (columns)');
  const ctRes = await call('GET', `/buckets/${args.bucket}/card_tables/${args.cardTable}.json`);
  abortOnAuthOrLimit(ctRes, 'GET card_table');
  dump(ctRes);

  const columns = extractColumns(ctRes.body);
  if (columns.length === 0) {
    console.error('No columns parsed from card_table response.');
    console.error('  → check the STEP 2 dump above: shape may differ from `{ lists: [...] }`.');
    console.error('  → cannot continue to per-column / per-card steps.');
    process.exit(1);
  }
  const firstColumnId = columns[0].id;
  const firstColumnLabel = columns[0].title ?? columns[0].type ?? String(columns[0].id);
  console.log(
    `(Found ${columns.length} column(s). Using column id=${firstColumnId} "${firstColumnLabel}" for subsequent steps.)`,
  );
  console.log('');

  // STEP 3: list cards in first column
  step(3, `GET /buckets/{bucket}/card_tables/lists/${firstColumnId}/cards.json`);
  const cardsRes = await call(
    'GET',
    `/buckets/${args.bucket}/card_tables/lists/${firstColumnId}/cards.json`,
  );
  abortOnAuthOrLimit(cardsRes, 'GET cards in column');
  dump(cardsRes);

  // STEP 4: single-card detail (best-effort — column may be empty)
  const firstCardId = extractFirstCardId(cardsRes.body);
  if (firstCardId !== null) {
    step(4, `GET /buckets/{bucket}/card_tables/cards/${firstCardId}.json`);
    const cardRes = await call(
      'GET',
      `/buckets/${args.bucket}/card_tables/cards/${firstCardId}.json`,
    );
    abortOnAuthOrLimit(cardRes, 'GET single card');
    dump(cardRes);
  } else {
    step(4, 'GET single card');
    console.log('  (skipped: column has no cards yet)');
    console.log('');
  }

  // STEP 5: create a probe card
  step(5, `POST /buckets/{bucket}/card_tables/lists/${firstColumnId}/cards.json`);
  const createRes = await call(
    'POST',
    `/buckets/${args.bucket}/card_tables/lists/${firstColumnId}/cards.json`,
    {
      title: '[probe] mcp-server feasibility test — safe to delete',
      content:
        '<div>Created by <code>scripts/probe-card-tables.ts</code>. Safe to delete.</div>',
    },
  );
  abortOnAuthOrLimit(createRes, 'POST create card');
  dump(createRes);

  if (createRes.status < 200 || createRes.status >= 300) {
    console.error('Create failed; skipping move/update/trash steps so we don’t fire off');
    console.error('  more requests against an API shape we don’t understand yet.');
    process.exit(1);
  }
  const newCardId =
    createRes.body && typeof createRes.body === 'object'
      ? (createRes.body as { id?: unknown }).id
      : undefined;
  if (typeof newCardId !== 'number') {
    console.error('Create response had no numeric `id` — cannot continue with move/update/trash.');
    process.exit(1);
  }
  console.log(`(New probe card id=${newCardId})`);
  console.log('');

  // STEP 6: move card to a different column (skip if only one column exists)
  const otherColumn = columns.find((c) => c.id !== firstColumnId);
  if (otherColumn) {
    step(6, `POST /buckets/{bucket}/card_tables/cards/${newCardId}/moves.json`);
    const moveRes = await call(
      'POST',
      `/buckets/${args.bucket}/card_tables/cards/${newCardId}/moves.json`,
      { column_id: otherColumn.id },
    );
    abortOnAuthOrLimit(moveRes, 'POST move card');
    dump(moveRes);
  } else {
    step(6, 'POST move card');
    console.log('  (skipped: card_table has only one column — nothing to move to)');
    console.log('');
  }

  // STEP 7: update card title + content
  step(7, `PUT /buckets/{bucket}/card_tables/cards/${newCardId}.json`);
  const updateRes = await call(
    'PUT',
    `/buckets/${args.bucket}/card_tables/cards/${newCardId}.json`,
    {
      title: '[probe] updated title — safe to delete',
      content: '<div>Updated by <code>probe-card-tables.ts</code>.</div>',
    },
  );
  abortOnAuthOrLimit(updateRes, 'PUT update card');
  dump(updateRes);

  // STEP 8: trash the probe card (best-effort cleanup)
  step(8, `PUT /buckets/{bucket}/recordings/${newCardId}/status/trashed.json`);
  const trashRes = await call(
    'PUT',
    `/buckets/${args.bucket}/recordings/${newCardId}/status/trashed.json`,
  );
  // Don't abort on 401/429 here — the probe is otherwise done. Just dump.
  dump(trashRes);
  if (trashRes.status < 200 || trashRes.status >= 300) {
    console.error(`Trash step failed (HTTP ${trashRes.status}).`);
    console.error(`  → probe card id=${newCardId} still exists; delete it manually from the UI.`);
  }

  console.log('Probe complete.');
}

main().catch((err) => {
  console.error('Probe failed with unhandled error:', err);
  process.exit(1);
});
