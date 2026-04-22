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

// ─── /my/assignments.json (MCP App: basecamp_my_plate) ──────────────────
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

/** Scopes accepted by basecamp_my_plate — mirrors the Basecamp endpoints. */
export type MyPlateScope =
  | 'open'
  | 'completed'
  | 'overdue'
  | 'due_today'
  | 'due_tomorrow'
  | 'due_later_this_week'
  | 'due_next_week'
  | 'due_later';

/** Normalized todo used by the rendered payload. */
export interface NormalizedTodo {
  id: number;
  type: string;
  content: string;
  dueOn: string | null;
  completed: boolean;
  priority: boolean;
  commentsCount: number;
  appUrl: string;
  assignees: Array<{ id: number; name: string }>;
  /** project_id — derived from bucket.id, used to invoke basecamp_complete_todo. */
  projectId: number;
}

export interface NormalizedList {
  listId: number;
  title: string;
  appUrl: string;
  todos: NormalizedTodo[];
}

export interface NormalizedGroup {
  bucketId: number;
  bucketName: string;
  appUrl: string;
  lists: NormalizedList[];
}

/** Payload produced by basecamp_my_plate; consumed by the UI renderer. */
export interface MyPlatePayload {
  scope: MyPlateScope;
  priorities: NormalizedTodo[];
  groups: NormalizedGroup[];
  /** Count of items surfaced by /my/assignments that were filtered out
   *  (non-"todo" types; e.g. card steps). For the LLM's text summary. */
  filteredNonTodoCount: number;
  fetchedAt: string; // ISO
}

/** Tool error surface — populated instead of groups/priorities on API failure. */
export interface MyPlateErrorPayload {
  scope: MyPlateScope;
  error: { message: string; retryAfterSec?: number };
  fetchedAt: string;
}
