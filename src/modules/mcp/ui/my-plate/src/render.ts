import type {
  DashboardErrorPayload,
  DashboardKpi,
  DashboardPayload,
  DashboardProjectStat,
  DashboardTodayItem,
  DashboardUnreadBreakdown,
  DashboardUpcomingDay,
  DashboardWaitingItem,
} from '../../../../../lib/types.js';

type Payload = DashboardPayload | DashboardErrorPayload;

function isError(p: Payload): p is DashboardErrorPayload {
  return 'error' in p;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function safeHref(url: string): string {
  // Only pass http(s) through; neutralize data:, javascript:, etc.
  return /^https?:/i.test(url) ? escape(url) : '#';
}

function formatHours(h: number): string {
  if (h < 1) {
    const m = Math.max(1, Math.round(h * 60));
    return `${m}m`;
  }
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

function renderKpi(kpi: DashboardKpi): string {
  const kpiCard = (
    color: 'red' | 'orange' | 'blue' | 'purple',
    value: string,
    label: string,
    context: string,
  ): string => `
    <div class="widget kpi ${color}" data-section="kpi">
      <div class="kpi-value">${escape(value)}</div>
      <div class="kpi-label">${escape(label)}</div>
      <div class="kpi-context">${context}</div>
    </div>`;

  const overdueCtx =
    kpi.overdue.oldestDaysLate === null
      ? 'none late'
      : `oldest <strong>${kpi.overdue.oldestDaysLate} day${kpi.overdue.oldestDaysLate === 1 ? '' : 's'}</strong> late`;
  const todayCtx =
    kpi.dueToday.count === 0
      ? 'nothing due'
      : kpi.dueToday.priorityCount > 0
        ? `${kpi.dueToday.priorityCount} <strong>★ priority</strong>`
        : 'no priority flag';
  const unreadCtx =
    kpi.unread.count === 0
      ? 'inbox zero'
      : `across <strong>${kpi.unread.distinctProjects} project${kpi.unread.distinctProjects === 1 ? '' : 's'}</strong>`;
  const waitingCtx =
    kpi.waiting.oldestHoursAgo === null
      ? 'no pings open'
      : `oldest waiting <strong>${escape(formatHours(kpi.waiting.oldestHoursAgo))}</strong>`;

  return `
    <section class="grid grid-4">
      ${kpiCard('red', String(kpi.overdue.count), 'Overdue', overdueCtx)}
      ${kpiCard('orange', String(kpi.dueToday.count), 'Due today', todayCtx)}
      ${kpiCard('blue', String(kpi.unread.count), 'Unread signals', unreadCtx)}
      ${kpiCard('purple', String(kpi.waiting.count), '@you · waiting', waitingCtx)}
    </section>`;
}

function renderTodayWidget(today: DashboardTodayItem[]): string {
  const body =
    today.length === 0
      ? '<div class="empty-today">Nothing due today — plate is clear ✨</div>'
      : `<div class="today-list">${today.map(renderTodayRow).join('')}</div>`;
  return `
    <div class="widget" data-section="today">
      <h3>Today · what's on the block <span class="meta-note">due_on = today</span></h3>
      ${body}
    </div>`;
}

function renderTodayRow(t: DashboardTodayItem): string {
  const cls = t.priority ? 't-row priority' : 't-row';
  const star = t.priority ? '<span class="star">★</span>' : '<span></span>';
  const dueChip = t.dueLabel ? `<span class="t-proj">${escape(t.dueLabel)}</span>` : '<span></span>';
  return `
    <div class="${cls}">
      ${star}
      <div>
        <div class="t-title">
          <a href="${safeHref(t.appUrl)}" target="_blank" rel="noreferrer">${escape(t.content)}</a>
        </div>
        <div class="t-proj">${escape(t.projectName)}</div>
      </div>
      ${dueChip}
    </div>`;
}

function renderUnreadWidget(u: DashboardUnreadBreakdown): string {
  const rows: Array<{ key: 'mentions' | 'pings' | 'chats' | 'messages'; label: string; count: number; seg: string }> = [
    { key: 'mentions', label: '@you', count: u.mentions, seg: 'mentions' },
    { key: 'pings', label: 'Pings', count: u.pings, seg: 'pings' },
    { key: 'chats', label: 'Chats', count: u.chats, seg: 'chats' },
    { key: 'messages', label: 'Messages', count: u.messages, seg: 'inbox' },
  ];
  const total = rows.reduce((n, r) => n + r.count, 0);

  const stack =
    total === 0
      ? '<div class="unread-stack empty"></div>'
      : `<div class="unread-stack">
          ${rows
            .filter((r) => r.count > 0)
            .map(
              (r) =>
                `<div class="seg ${r.seg}" style="flex: ${r.count}" title="${escape(r.label)} · ${r.count}">${r.count}</div>`,
            )
            .join('')}
        </div>`;

  const legend = rows
    .map(
      (r) => `
      <div class="ul-row">
        <span><span class="dot ${r.seg}"></span><span class="label">${escape(r.label)}</span></span>
        <span class="count">${r.count}</span>
      </div>`,
    )
    .join('');

  const foot = u.oldest
    ? `<div class="unread-foot">
        oldest unread · <strong>${escape(formatHours(u.oldest.hoursAgo))}</strong> · ${escape(u.oldest.title)} — ${escape(u.oldest.creator)} (${escape(u.oldest.project)})
      </div>`
    : '<div class="unread-foot">no unread signals</div>';

  return `
    <div class="widget" data-section="unread">
      <h3>Unread · by type <span class="meta-note">/my/readings.json · section</span></h3>
      ${stack}
      <div class="unread-legend">${legend}</div>
      ${foot}
    </div>`;
}

function renderProjects(projects: DashboardProjectStat[]): string {
  const max = projects.reduce((n, p) => Math.max(n, p.openCount), 0);
  const rows =
    projects.length === 0
      ? '<div class="empty-today">No open todos assigned to you.</div>'
      : projects
          .map((p) => {
            const width = max > 0 ? Math.max(8, Math.round((p.openCount / max) * 100)) : 0;
            const urgent =
              p.urgentCount > 0
                ? `<span class="urgent-tag">🔥 ${p.urgentCount}</span>`
                : '';
            const hot = p.urgentCount > 0 ? 'fill hot' : 'fill';
            return `
              <div class="proj-row">
                <span class="proj-name">${escape(p.name)}</span>
                <div class="proj-bar"><div class="${hot}" style="width:${width}%"></div></div>
                <div class="proj-stats"><strong>${p.openCount}</strong> open ${urgent}</div>
              </div>`;
          })
          .join('');
  return `
    <section class="widget" data-section="projects">
      <h3>Open todos by project <span class="meta-note">sorted desc · 🔥 = overdue or due today</span></h3>
      ${rows}
    </section>`;
}

function renderUpcoming(upcoming: DashboardUpcomingDay[]): string {
  const max = upcoming.reduce((n, d) => Math.max(n, d.count), 0);
  const heaviest = upcoming.reduce(
    (acc: DashboardUpcomingDay | null, d) => (!acc || d.count > acc.count ? d : acc),
    null,
  );
  const total = upcoming.reduce((n, d) => n + d.count, 0);

  const cells = upcoming
    .map((d) => {
      let pct = 0;
      let tone: 'hot' | 'medium' | 'light' | 'rest' = 'rest';
      if (d.count > 0 && max > 0) {
        pct = Math.max(8, Math.round((d.count / max) * 80));
        tone = d.count >= 3 ? 'hot' : d.count >= 2 ? 'medium' : 'light';
      } else {
        pct = 6;
        tone = 'rest';
      }
      const countDisplay =
        d.count === 0
          ? `<div class="day-count muted">—</div>`
          : `<div class="day-count${d.priorityCount > 0 ? ' star' : ''}">${d.count}</div>`;
      const labelCls = d.label === 'today' ? 'day-label today' : 'day-label';
      return `
        <div class="day">
          <div class="day-bar-wrap"><div class="day-bar ${tone}" style="height:${pct}%"></div></div>
          ${countDisplay}
          <div class="${labelCls}">${escape(d.label === 'today' ? 'Today' : d.label)}</div>
        </div>`;
    })
    .join('');

  const foot =
    total === 0
      ? '<span>No due dates in the next 7 days</span>'
      : `<span><strong>${escape(heaviest!.label === 'today' ? 'Today' : heaviest!.label)}</strong> is your heaviest day · ${heaviest!.count} item${heaviest!.count === 1 ? '' : 's'} due</span>
         <span><strong>${total}</strong> todo${total === 1 ? '' : 's'} upcoming</span>`;

  return `
    <section class="widget" data-section="upcoming">
      <h3>Upcoming load · next 7 days <span class="meta-note">bar height = todos due that day</span></h3>
      <div class="upcoming">${cells}</div>
      <div class="widget-foot">${foot}</div>
    </section>`;
}

function renderWaiting(items: DashboardWaitingItem[]): string {
  if (items.length === 0) {
    return `
      <section class="widget" data-section="waiting">
        <h3>Waiting on you <span class="meta-note">time waiting since ping</span></h3>
        <div class="empty-today">Nobody's pinged you — nice.</div>
      </section>`;
  }
  const maxHours = items.reduce((n, w) => Math.max(n, w.hoursAgo), 0);
  const rows = items
    .map((w) => {
      const width = maxHours > 0 ? Math.max(5, Math.round((w.hoursAgo / maxHours) * 100)) : 0;
      const fillCls =
        w.severity === 'red'
          ? 'fill cold'
          : w.severity === 'orange'
            ? 'fill'
            : 'fill amber';
      return `
        <div class="wait-row">
          <span class="wait-who">${escape(w.who)}</span>
          <span class="wait-what">${escape(w.what)} · <em>${escape(w.projectName)}</em></span>
          <div class="wait-time-bar"><div class="${fillCls}" style="width:${width}%"></div></div>
          <span class="wait-ago">${escape(formatHours(w.hoursAgo))}</span>
          <span class="wait-sev"><span class="sev-dot ${escape(w.severity)}"></span></span>
        </div>`;
    })
    .join('');
  return `
    <section class="widget" data-section="waiting">
      <h3>Waiting on you <span class="meta-note">time waiting since ping</span></h3>
      ${rows}
    </section>`;
}

function renderHeader(p: DashboardPayload): string {
  const when = new Date(p.generatedAt);
  const stamp = Number.isNaN(when.getTime())
    ? 'synced'
    : `synced ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `
    <header class="top">
      <div><h1>My Plate<span class="sub">· Basecamp Dashboard</span></h1></div>
      <div class="status"><span class="live-dot"></span><span>${escape(stamp)}</span></div>
    </header>`;
}

function renderErrorCard(p: DashboardErrorPayload): string {
  const retry =
    p.error.retryAfterSec !== undefined ? ` (retry in ${p.error.retryAfterSec}s)` : '';
  return `
    <div class="error-card" data-section="error" role="alert">
      <strong>Something broke.</strong> ${escape(p.error.message)}${escape(retry)}
    </div>`;
}

/** Paint the dashboard into `root`. Clears existing content. No interaction
 *  wiring — the dashboard is display-only. */
export function render(root: HTMLElement, payload: Payload): void {
  if (isError(payload)) {
    root.innerHTML = `<div class="app">${renderErrorCard(payload)}</div>`;
    return;
  }

  root.innerHTML = `
    <div class="app">
      ${renderHeader(payload)}
      ${renderKpi(payload.kpi)}
      <section class="grid grid-2">
        ${renderTodayWidget(payload.today)}
        ${renderUnreadWidget(payload.unreadBreakdown)}
      </section>
      ${renderProjects(payload.projects)}
      ${renderUpcoming(payload.upcoming)}
      ${renderWaiting(payload.waitingOnYou)}
    </div>`;
}
