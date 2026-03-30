# Basecamp 3 API Reference

## Base URL
```
https://3.basecampapi.com/{account_id}/
```

## Required Headers
```
Authorization: Bearer {access_token}
User-Agent: BasecampAgent (support@example.com)
Content-Type: application/json; charset=utf-8   # for POST/PUT
```

## Rate Limiting
- 50 requests per 10 seconds per IP
- On 429: wait for `Retry-After` header value (seconds)
- On 5xx: retry with exponential backoff

## Pagination
- Response includes `Link` header with `rel="next"` for next page
- `X-Total-Count` header shows total count
- Do NOT construct pagination URLs manually — follow Link headers

---

## Projects
```
GET    /projects.json                    # List all active projects (paginated)
GET    /projects/{id}.json               # Get project (includes dock array)
POST   /projects.json                    # Create project { name, description }
PUT    /projects/{id}.json               # Update project
DELETE /projects/{id}.json               # Trash project
```

Project response includes a `dock` array — each dock entry has:
- `name`: "todoset", "message_board", "chat", "schedule", "vault", etc.
- `url`: API URL for that dock
- `enabled`: boolean

## To-Do Sets (accessed via project dock)
```
GET    /todosets/{id}.json               # Get todoset
GET    /todosets/{id}/todolists.json     # List todolists in set
POST   /todosets/{id}/todolists.json     # Create todolist { name, description }
```

## To-Do Lists
```
GET    /todolists/{id}.json              # Get todolist (includes todos summary)
PUT    /todolists/{id}.json              # Update todolist { name, description }
GET    /todolists/{id}/todos.json        # List todos (filter: ?status=active|completed)
POST   /todolists/{id}/todos.json        # Create todo
```

## To-Dos
```
GET    /todos/{id}.json                  # Get todo
PUT    /todos/{id}.json                  # Update todo
POST   /todos/{id}/completion.json       # Complete todo
DELETE /todos/{id}/completion.json       # Uncomplete todo
PUT    /todos/{id}/position.json         # Reposition { position: 1 }
```

Create/Update todo body:
```json
{
  "content": "Task title",
  "description": "<div>Rich text description</div>",
  "assignee_ids": [12345],
  "due_on": "2026-04-15",
  "starts_on": "2026-04-01",
  "notify": true
}
```

## Messages
```
GET    /message_boards/{id}.json             # Get message board
GET    /message_boards/{id}/messages.json    # List messages (paginated)
GET    /messages/{id}.json                   # Get message
POST   /message_boards/{id}/messages.json    # Create message { subject, content, category_id }
PUT    /messages/{id}.json                   # Update message
```

## Campfire (Chat)
```
GET    /chats.json                       # List all campfires
GET    /chats/{id}.json                  # Get campfire
GET    /chats/{id}/lines.json            # List chat lines (paginated)
GET    /chats/{id}/lines/{id}.json       # Get specific line
POST   /chats/{id}/lines.json            # Send message (see below)
DELETE /chats/{id}/lines/{id}.json       # Delete message
```

### Sending Campfire messages

**IMPORTANT**: To send properly formatted rich text messages, you MUST include `content_type: "text/html"` in the request body. Without it, HTML tags like `<div>` and `<br>` will be rendered as plain text.

```json
{
  "content": "<div>Your message here.<br><br>Second paragraph.</div>",
  "content_type": "text/html"
}
```

- With `content_type: "text/html"` → creates `Chat::Lines::RichText` (renders HTML properly)
- Without `content_type` → creates `Chat::Lines::Text` (HTML tags shown as raw text)

Allowed HTML tags: `div`, `h1`, `br`, `strong`, `em`, `strike`, `a` (with href), `pre`, `ol`, `ul`, `li`, `blockquote`.

```
```

## Comments
```
GET    /recordings/{id}/comments.json    # List comments on any recording
GET    /comments/{id}.json               # Get comment
POST   /recordings/{id}/comments.json    # Add comment { content: "<div>...</div>" }
PUT    /comments/{id}.json               # Update comment
```

## People
```
GET    /people.json                      # List all people
GET    /projects/{id}/people.json        # List people in project
GET    /people/{id}.json                 # Get person
GET    /my/profile.json                  # Current user profile
```

## Recordings (Archive/Trash)
```
GET    /projects/recordings.json?type=Todo&bucket={project_id}  # Search recordings
PUT    /recordings/{id}/status/trashed.json    # Trash
PUT    /recordings/{id}/status/archived.json   # Archive
PUT    /recordings/{id}/status/active.json     # Restore
```

## Pin/Unpin
```
POST   /recordings/{id}/pin.json         # Pin a recording
DELETE /recordings/{id}/pin.json         # Unpin

```

## Attachments
```
POST   /attachments.json                 # Upload (binary body, ?name=filename.ext)
```

---

## Dock Name → Resource Mapping

| Dock Name       | Resource        | Typical Actions                    |
|----------------|-----------------|------------------------------------|
| todoset        | To-do Sets      | List/create todolists and todos    |
| message_board  | Message Board   | List/create/read messages          |
| chat           | Campfire        | Send/read chat messages            |
| schedule       | Schedule        | Calendar entries                   |
| vault          | Vault/Docs      | Documents and files                |
| inbox          | Inbox           | Forwarded emails                   |
