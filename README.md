# Design Iteration Tracker

LAN web app that replaces the Excel design iteration tracker: design considerations,
the iterations made against them, and the flags (reviews, FYIs, actions) they raise for
other people and domains. Every iteration and every hand-over is traceable.

> **Status: stage 1 of 4.** The data model, the REST API and the tests are in place.
> The browser UI comes in stage 2. Full install, service, backup and firewall
> instructions come with stage 4.

## Requirements

- Node.js 20 or 22 LTS (Windows x64 prebuilt binaries are used for SQLite, no compiler needed).

## Commands

```
npm install      # install
npm run build    # compile
npm start        # serve on http://0.0.0.0:8080
npm test         # run the test suite
```

The database is created at `./data/tracker.db` on first start (SQLite, WAL mode). It
starts empty except for the set-up taken from the Excel tracker: domains SH, CK, DC, SL
with their owners, colours and sub-systems; the users Oscar (manager), Nilan, Nisath,
Kulunu, Upul and Sajith; and the verdict, status and flag-type lists.

On first run, Oscar sets his password (`POST /api/setup`). He then gives each designer a
temporary password, which they must change at their first sign-in.

## Configuration

Optional `config.json` next to `package.json`:

```json
{
  "port": 8080,
  "appUrl": "http://192.168.1.20:8080",
  "smtp": { "host": "mail.example.local", "port": 25, "from": "tracker@example.local" }
}
```

## How it works (stage 1)

| Area | Where |
|---|---|
| Schema and migrations | `server/src/db/migrations.ts` |
| Initial set-up data | `server/src/db/seed.ts` |
| ID generation (race-free, never reused) | `server/src/ids.ts` |
| Business rules: create/update, parent/origin links, notifications | `server/src/services/records.ts` |
| Who may edit what | `server/src/permissions.ts` |
| Audit log, follows, notifications, live events | `server/src/context.ts` |
| REST routes | `server/src/routes/*.ts`, `server/src/auth.ts` |

### Rules
- **IDs:** `SH-C01` (running number per domain), `SH-C01-I03` (per consideration), and
  `SH-C01-I03-F1` (per iteration). The server generates them inside a `BEGIN IMMEDIATE`
  transaction. They never change and are never reused.
- **Nothing is deleted.** Records are set to Withdrawn instead, and attachments are hidden.
- **Read-only when Closed:** a Closed iteration can't be edited until a manager reopens it.
- **Edit permissions:** a consideration can be edited by its owner, its creator or a manager;
  an iteration by its author, the consideration owner or a manager. A flag's request can be
  edited by whoever raised it or a manager. The assignee or a manager writes the response;
  the assignee, the raiser or a manager sets the status. Everyone signed in can read
  everything and comment.
- **Stale edits:** every `PATCH` sends the `version` the client loaded. If someone saved in
  between, the server replies `409 stale` and includes the current record.
- **Audit log:** every change writes one audit row per field. The activity feed is built from
  these rows.
- **Lookup values:** verdicts, statuses and flag types can be renamed or added. Each value
  keeps a fixed *behaviour* (pass / conditional / fail, open / closed / withdrawn, ...),
  which is what the rules use.

### Main endpoints
`/api/auth/*`, `/api/setup`, `/api/meta` (dropdown data),
`/api/considerations`, `/api/iterations`, `/api/flags` (list with filters, detail, create, PATCH),
`/api/entries` (consideration + iteration + flags in one submit), `/api/ids/next` (ID preview),
`/api/flags/:id/consideration` (create consideration from a flag),
`/api/iterations/:id/reopen`, `/api/my-items`, `/api/feed`, `/api/notifications`,
`/api/follows`, `/api/comments`, `/api/attachments/*`, `/api/history`, `/api/stream` (SSE),
`/api/users`, `/api/domains`, `/api/subsystems`, `/api/lookups` (manager only).
