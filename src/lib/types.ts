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
