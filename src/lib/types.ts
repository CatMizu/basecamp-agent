/**
 * Basecamp 3 domain types — just the fields we actually read in tool handlers.
 * Basecamp returns many more, but typing only what's used keeps the surface
 * tight and saves a round of deserialization pain.
 */

export interface BasecampPerson {
  id: number;
  name: string;
  email_address: string;
  title?: string | null;
  bio?: string | null;
  admin?: boolean;
  owner?: boolean;
  client?: boolean;
  avatar_url?: string;
  time_zone?: string;
}

export interface BasecampDockEntry {
  id: number;
  title: string;
  name: string; // "todoset", "message_board", "chat", "schedule", "vault", ...
  enabled: boolean;
  position: number | null;
  url: string;
  app_url: string;
}

export interface BasecampProject {
  id: number;
  name: string;
  description: string | null;
  purpose: string;
  status: string;
  created_at: string;
  updated_at: string;
  bookmark_url?: string;
  url: string;
  app_url: string;
  dock: BasecampDockEntry[];
}

export interface BasecampTodolist {
  id: number;
  title: string;
  name?: string;
  description: string | null;
  type: string;
  completed: boolean;
  completed_ratio?: string;
  todos_url: string;
  groups_url?: string;
  url: string;
  app_url: string;
  created_at: string;
  updated_at: string;
}

export interface BasecampTodo {
  id: number;
  title: string;
  content?: string;
  description?: string | null;
  completed: boolean;
  completion?: {
    created_at: string;
    creator: BasecampPerson;
  } | null;
  due_on: string | null;
  starts_on?: string | null;
  assignees?: BasecampPerson[];
  creator?: BasecampPerson;
  created_at: string;
  updated_at: string;
  url: string;
  app_url: string;
  parent?: { id: number; title: string; type: string; url: string };
  bucket?: { id: number; name: string; type: string };
}

export interface BasecampMessage {
  id: number;
  subject: string;
  content: string;
  status: string;
  created_at: string;
  updated_at: string;
  creator: BasecampPerson;
  comments_count?: number;
  url: string;
  app_url: string;
  parent?: { id: number; title: string; type: string; url: string };
  bucket?: { id: number; name: string; type: string };
}

export interface BasecampChat {
  id: number;
  title: string;
  topic?: string | null;
  lines_count: number;
  created_at: string;
  updated_at: string;
  lines_url: string;
  url: string;
  app_url: string;
  bucket?: { id: number; name: string; type: string };
}

export interface BasecampChatLine {
  id: number;
  content: string;
  created_at: string;
  updated_at: string;
  creator: BasecampPerson;
  url: string;
  app_url: string;
  parent?: { id: number; title: string; type: string; url: string };
  bucket?: { id: number; name: string; type: string };
}

export interface BasecampAuthorizationResponse {
  expires_at: string;
  identity: {
    id: number;
    first_name: string;
    last_name: string;
    email_address: string;
  };
  accounts: Array<{
    product: string; // "bc3" | "bcx" | "campfire" | "highrise" | ...
    id: number;
    name: string;
    href: string;
    app_href: string;
  }>;
}

// ─── /my/assignments.json ────────────────────────────────────────────────
// NOTE: Everything below is also consumed by the UI bundle (tsconfig.ui.json
// includes this file). Keep it UI-safe: no node-only imports, no runtime
// code — pure type declarations only.

/** Shape of one entry in /my/assignments.json priorities/non_priorities. */
export interface BasecampAssignment {
  id: number;
  content: string;
  type: string; // "todo" | "Todo" | "CardTable::Card::Step" | …
  app_url: string;
  due_on: string | null;
  starts_on: string | null;
  completed: boolean;
  bucket: { id: number; name: string; app_url: string };
  parent: { id: number; title: string; app_url: string };
  assignees: Array<{ id: number; name: string }>;
  comments_count: number;
  has_description: boolean;
}

export interface BasecampMyAssignmentsResponse {
  priorities: BasecampAssignment[];
  non_priorities: BasecampAssignment[];
}

/** Scopes accepted by Basecamp's /my/assignments endpoints. */
export type MyPlateScope =
  | 'open'
  | 'completed'
  | 'overdue'
  | 'due_today'
  | 'due_tomorrow'
  | 'due_later_this_week'
  | 'due_next_week'
  | 'due_later';

// ─── /my/readings.json ───────────────────────────────────────────────────

/** Section categories returned by /my/readings.json. */
export type BasecampReadingSection =
  | 'inbox'
  | 'chats'
  | 'pings'
  | 'mentions'
  | 'remembered';

/** One notification from /my/readings.json (unreads/reads/memories). Only
 *  types the fields we consume; full shape has ~20 fields we ignore. */
export interface BasecampReading {
  id: number;
  created_at: string;
  updated_at: string;
  section: BasecampReadingSection;
  unread_count: number;
  unread_at: string | null;
  read_at: string | null;
  readable_sgid: string;
  readable_identifier?: string;
  title: string;
  type: string;
  bucket_name: string;
  creator: {
    id: number;
    name: string;
    email_address?: string;
  };
  content_excerpt?: string;
  app_url: string;
}

export interface BasecampReadingsResponse {
  unreads: BasecampReading[];
  reads: BasecampReading[];
  memories: BasecampReading[];
}

// ─── Dashboard (basecamp_my_plate MCP App) ───────────────────────────────

export interface DashboardKpi {
  overdue: { count: number; oldestDaysLate: number | null };
  dueToday: { count: number; priorityCount: number };
  unread: { count: number; distinctProjects: number };
  waiting: { count: number; oldestHoursAgo: number | null };
}

export interface DashboardTodayItem {
  id: number;
  content: string;
  appUrl: string;
  priority: boolean;
  projectName: string;
  /** Display string for the right column; always the ISO `due_on` today. */
  dueLabel: string;
}

export interface DashboardUnreadBreakdown {
  mentions: number;
  pings: number;
  chats: number;
  messages: number; // section === 'inbox'
  oldest: {
    title: string;
    hoursAgo: number;
    creator: string;
    project: string;
    section: BasecampReadingSection;
  } | null;
}

export interface DashboardProjectStat {
  id: number;
  name: string;
  openCount: number;
  urgentCount: number; // overdue ∪ due_today intersecting this project
}

export interface DashboardUpcomingDay {
  /** ISO date (YYYY-MM-DD) in the viewer's local day alignment. */
  date: string;
  /** Lowercase weekday abbrev (mon/tue/...) or 'today' for today. */
  label: string;
  count: number;
  priorityCount: number;
}

export type DashboardWaitingSeverity = 'red' | 'orange' | 'amber';

export interface DashboardWaitingItem {
  who: string;
  what: string;
  projectName: string;
  section: 'mentions' | 'pings';
  hoursAgo: number;
  severity: DashboardWaitingSeverity;
  appUrl: string;
  readableSgid: string;
}

/** Payload produced by basecamp_my_plate; consumed by the dashboard UI. */
export interface DashboardPayload {
  generatedAt: string; // ISO
  kpi: DashboardKpi;
  today: DashboardTodayItem[];
  unreadBreakdown: DashboardUnreadBreakdown;
  projects: DashboardProjectStat[]; // sorted desc by openCount
  upcoming: DashboardUpcomingDay[]; // exactly 7 entries, today + next 6
  waitingOnYou: DashboardWaitingItem[]; // top 5
}

/** Error fallback: rendered as the error card when buildDashboard throws. */
export interface DashboardErrorPayload {
  error: { message: string; retryAfterSec?: number };
  generatedAt: string;
}
