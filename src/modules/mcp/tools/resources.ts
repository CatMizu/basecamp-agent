import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { logger } from '../../shared/logger.js';

const MY_PLATE_URI = 'ui://basecamp/my-plate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load and cache the bundled my-plate HTML at module-init time. Throws if
 * the Vite build hasn't run — keeps production surprises loud.
 */
function loadMyPlateHtml(): string {
  // At runtime, this file lives at dist/modules/mcp/tools/resources.js; walk
  // up to dist/, then into dist/ui/.
  const candidate = path.resolve(__dirname, '..', '..', '..', 'ui', 'my-plate.html');
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `my-plate UI bundle missing at ${candidate}; run \`npm run build:ui\` first.`,
    );
  }
  const html = fs.readFileSync(candidate, 'utf8');
  logger.debug('Loaded my-plate UI bundle', { bytes: String(html.length) });
  return html;
}

let myPlateHtmlCache: string | null = null;

export function registerUiResources(server: McpServer): void {
  if (myPlateHtmlCache === null) {
    myPlateHtmlCache = loadMyPlateHtml();
  }
  const html = myPlateHtmlCache;

  registerAppResource(
    server,
    MY_PLATE_URI,
    MY_PLATE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [{ uri: MY_PLATE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
    }),
  );
}
