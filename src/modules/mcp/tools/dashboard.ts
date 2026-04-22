import type { BasecampContext } from './auth-context.js';
import type {
  BasecampAssignment,
  BasecampReading,
  BasecampReadingsResponse,
  DashboardErrorPayload,
  DashboardKpi,
  DashboardPayload,
  DashboardProjectStat,
  DashboardTodayItem,
  DashboardUnreadBreakdown,
  DashboardUpcomingDay,
  DashboardWaitingItem,
  DashboardWaitingSeverity,
} from '../../../lib/types.js';
import {
  BasecampApiError,
  BasecampAuthError,
  BasecampNotFoundError,
  BasecampRateLimitError,
  getMyAssignments,
  getMyReadings,
  type MyPlateAssignment,
} from './basecamp-api.js';

export interface DashboardInput {
  overdue: MyPlateAssignment[];
  dueToday: MyPlateAssignment[];
  dueTomorrow: MyPlateAssignment[];
  dueLaterThisWeek: MyPlateAssignment[];
  dueNextWeek: MyPlateAssignment[];
  open: MyPlateAssignment[];
  readings: BasecampReadingsResponse;
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function isTodo(a: BasecampAssignment): boolean {
  return a.type === 'Todo' || a.type === 'todo';
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseDueOn(dueOn: string): Date {
  // Basecamp returns "YYYY-MM-DD" — treat as local midnight so day math aligns
  // with the user's wall clock, not UTC.
  return new Date(dueOn + 'T00:00:00');
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

function roundTenths(n: number): number {
  return Math.round(n * 10) / 10;
}

function priorityIdSet(open: MyPlateAssignment[]): Set<number> {
  return new Set(open.filter((a) => a.priority).map((a) => a.id));
}

function buildKpi(input: DashboardInput): DashboardKpi {
  const today = startOfDay(input.now);
  const overdueTodos = input.overdue.filter(isTodo);
  const dueTodayTodos = input.dueToday.filter(isTodo);

  const oldestDaysLate = overdueTodos.reduce<number | null>((acc, a) => {
    if (!a.due_on) return acc;
    const late = daysBetween(parseDueOn(a.due_on), today);
    if (late <= 0) return acc;
    return acc === null ? late : Math.max(acc, late);
  }, null);

  const priorityCount = dueTodayTodos.filter((a) =>
    priorityIdSet(input.open).has(a.id),
  ).length;

  const distinctProjects = new Set(
    input.readings.unreads.map((u) => u.bucket_name).filter(Boolean),
  ).size;

  const waitingUnreads = input.readings.unreads.filter(isWaiting);
  const oldestWaitingHours = waitingUnreads.reduce<number | null>((acc, u) => {
    const hours = unreadHoursAgo(u, input.now);
    if (hours === null) return acc;
    return acc === null ? hours : Math.max(acc, hours);
  }, null);

  return {
    overdue: { count: overdueTodos.length, oldestDaysLate },
    dueToday: { count: dueTodayTodos.length, priorityCount },
    unread: { count: input.readings.unreads.length, distinctProjects },
    waiting: {
      count: waitingUnreads.length,
      oldestHoursAgo: oldestWaitingHours === null ? null : roundTenths(oldestWaitingHours),
    },
  };
}

function buildToday(input: DashboardInput): DashboardTodayItem[] {
  const priorities = priorityIdSet(input.open);
  return input.dueToday.filter(isTodo).map((a) => ({
    id: a.id,
    content: a.content,
    appUrl: a.app_url,
    priority: priorities.has(a.id),
    projectName: a.bucket.name,
    // Right-column hint; Basecamp's `due_on` is date-only, so for today's
    // items there's no time-of-day to render. Left blank to avoid a
    // redundant "2026-04-22" on every row.
    dueLabel: '',
  }));
}

function buildUnreadBreakdown(input: DashboardInput): DashboardUnreadBreakdown {
  const unreads = input.readings.unreads;
  const countBy = (section: BasecampReading['section']): number =>
    unreads.filter((u) => u.section === section).length;

  let oldest: DashboardUnreadBreakdown['oldest'] = null;
  for (const u of unreads) {
    const hours = unreadHoursAgo(u, input.now);
    if (hours === null) continue;
    if (!oldest || hours > oldest.hoursAgo) {
      oldest = {
        title: u.title,
        hoursAgo: roundTenths(hours),
        creator: u.creator.name,
        project: u.bucket_name,
        section: u.section,
      };
    }
  }

  return {
    mentions: countBy('mentions'),
    pings: countBy('pings'),
    chats: countBy('chats'),
    messages: countBy('inbox'),
    oldest,
  };
}

function buildProjects(input: DashboardInput): DashboardProjectStat[] {
  const urgentIds = new Set<number>();
  for (const a of [...input.overdue, ...input.dueToday]) {
    if (isTodo(a)) urgentIds.add(a.id);
  }

  const byBucket = new Map<number, DashboardProjectStat>();
  for (const a of input.open.filter(isTodo)) {
    const entry = byBucket.get(a.bucket.id) ?? {
      id: a.bucket.id,
      name: a.bucket.name,
      openCount: 0,
      urgentCount: 0,
    };
    entry.openCount += 1;
    if (urgentIds.has(a.id)) entry.urgentCount += 1;
    byBucket.set(a.bucket.id, entry);
  }

  return Array.from(byBucket.values()).sort((a, b) => b.openCount - a.openCount);
}

function buildUpcoming(input: DashboardInput): DashboardUpcomingDay[] {
  const today = startOfDay(input.now);
  const priorities = priorityIdSet(input.open);

  const all = [
    ...input.dueToday,
    ...input.dueTomorrow,
    ...input.dueLaterThisWeek,
    ...input.dueNextWeek,
  ].filter(isTodo);

  const byDate = new Map<string, { count: number; priorityCount: number }>();
  for (const a of all) {
    if (!a.due_on) continue;
    const date = a.due_on.substring(0, 10);
    const entry = byDate.get(date) ?? { count: 0, priorityCount: 0 };
    entry.count += 1;
    if (priorities.has(a.id)) entry.priorityCount += 1;
    byDate.set(date, entry);
  }

  const cells: DashboardUpcomingDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const date = isoDate(d);
    const entry = byDate.get(date) ?? { count: 0, priorityCount: 0 };
    const label = i === 0 ? 'today' : WEEKDAYS[d.getDay()];
    cells.push({ date, label, count: entry.count, priorityCount: entry.priorityCount });
  }
  return cells;
}

function severity(hoursAgo: number): DashboardWaitingSeverity {
  if (hoursAgo > 4) return 'red';
  if (hoursAgo > 0.5) return 'orange';
  return 'amber';
}

function isWaiting(u: BasecampReading): boolean {
  return u.section === 'mentions' || u.section === 'pings';
}

/** Hours between a reading's "waiting-since" timestamp and `now`. Null if
 *  no usable timestamp or if the timestamp is in the future. */
function unreadHoursAgo(u: BasecampReading, now: Date): number | null {
  const ts = u.unread_at ?? u.created_at;
  if (!ts) return null;
  const hours = hoursBetween(new Date(ts), now);
  if (hours < 0) return null;
  return hours;
}

function buildWaiting(input: DashboardInput): DashboardWaitingItem[] {
  const waiters: Array<{ r: BasecampReading; hoursAgo: number }> = [];
  for (const u of input.readings.unreads) {
    if (!isWaiting(u)) continue;
    const hours = unreadHoursAgo(u, input.now);
    if (hours === null) continue;
    waiters.push({ r: u, hoursAgo: hours });
  }
  waiters.sort((a, b) => b.hoursAgo - a.hoursAgo);
  return waiters.slice(0, 5).map(({ r, hoursAgo }) => ({
    who: r.creator.name,
    what: r.content_excerpt?.trim() || r.title,
    projectName: r.bucket_name,
    section: r.section as 'mentions' | 'pings',
    hoursAgo: roundTenths(hoursAgo),
    severity: severity(hoursAgo),
    appUrl: r.app_url,
    readableSgid: r.readable_sgid,
  }));
}

/** Pure transform from pre-fetched Basecamp data to dashboard payload.
 *  Exported for unit testing without any API mocking. */
export function computeDashboard(input: DashboardInput): DashboardPayload {
  return {
    generatedAt: input.now.toISOString(),
    kpi: buildKpi(input),
    today: buildToday(input),
    unreadBreakdown: buildUnreadBreakdown(input),
    projects: buildProjects(input),
    upcoming: buildUpcoming(input),
    waitingOnYou: buildWaiting(input),
  };
}

/** Fetch all inputs in parallel (one 7-call fan-out, well under 50/10s) and
 *  build the dashboard payload. Any sub-call error propagates — the handler
 *  maps it via toDashboardError. */
export async function buildDashboard(
  ctx: BasecampContext,
  now: Date = new Date(),
): Promise<DashboardPayload> {
  const [
    overdue,
    dueToday,
    dueTomorrow,
    dueLaterThisWeek,
    dueNextWeek,
    open,
    readings,
  ] = await Promise.all([
    getMyAssignments(ctx, 'overdue'),
    getMyAssignments(ctx, 'due_today'),
    getMyAssignments(ctx, 'due_tomorrow'),
    getMyAssignments(ctx, 'due_later_this_week'),
    getMyAssignments(ctx, 'due_next_week'),
    getMyAssignments(ctx, 'open'),
    getMyReadings(ctx),
  ]);

  return computeDashboard({
    overdue,
    dueToday,
    dueTomorrow,
    dueLaterThisWeek,
    dueNextWeek,
    open,
    readings,
    now,
  });
}

/** Translate any thrown error into a DashboardErrorPayload. */
export function toDashboardError(
  err: unknown,
  now: Date = new Date(),
): DashboardErrorPayload {
  let message = 'Unknown error';
  let retryAfterSec: number | undefined;
  if (err instanceof BasecampRateLimitError) {
    message = 'Basecamp rate limit hit.';
    retryAfterSec = err.retryAfterSec;
  } else if (err instanceof BasecampAuthError) {
    message = `Basecamp connector needs to be reconnected: ${err.message}`;
  } else if (err instanceof BasecampNotFoundError) {
    message = 'Basecamp resource not found';
  } else if (err instanceof BasecampApiError) {
    message = `Basecamp API error (${err.status}): ${err.message}`;
  } else if (err instanceof Error) {
    message = err.message;
  }
  return {
    error: retryAfterSec === undefined ? { message } : { message, retryAfterSec },
    generatedAt: now.toISOString(),
  };
}

/** One-line KPI summary for the LLM transcript (when the UI isn't rendered). */
export function dashboardSummary(p: DashboardPayload): string {
  const { overdue, dueToday, unread, waiting } = p.kpi;
  return `My plate — ${overdue.count} overdue, ${dueToday.count} due today, ${unread.count} unread, ${waiting.count} waiting on you.`;
}
