import { App } from '@modelcontextprotocol/ext-apps';
import { render } from './render.js';
import type {
  DashboardPayload,
  DashboardErrorPayload,
} from '../../../../../lib/types.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

const app = new App({ name: 'Basecamp Dashboard', version: '0.2.0' });

function isDashboardPayload(
  sc: unknown,
): sc is DashboardPayload | DashboardErrorPayload {
  if (sc === null || typeof sc !== 'object') return false;
  if ('error' in sc && 'generatedAt' in sc) return true;
  const p = sc as Partial<DashboardPayload>;
  return (
    typeof p.generatedAt === 'string' &&
    typeof p.kpi === 'object' &&
    Array.isArray(p.today) &&
    Array.isArray(p.upcoming)
  );
}

function renderError(message: string): void {
  render(root!, {
    error: { message },
    generatedAt: new Date().toISOString(),
  });
}

app.ontoolresult = (result) => {
  const sc = (result as { structuredContent?: unknown }).structuredContent;
  if (!isDashboardPayload(sc)) return;
  render(root, sc);
};

window.addEventListener('error', (e) => {
  renderError(`UI error: ${e.message}`);
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = (e.reason as { message?: string } | undefined)?.message ?? String(e.reason);
  renderError(`UI error: ${reason}`);
});

void app.connect();
