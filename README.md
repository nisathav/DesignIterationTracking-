# Design Iteration Tracker

LAN web app that replaces the Excel design iteration tracker: design considerations,
the iterations made against them, and the flags (reviews, FYIs, actions) they raise for
other people and domains. Every iteration and every hand-over is traceable.

> **Status: stage 3 of 4.** Working: sign-in, team activity feed, My Items, domain board, new
> entry, lists, consideration and flag pages with reviews and escalation, live notifications
> (optional email), and admin for users, domains, sub-systems and dropdown lists. Still to
> come in stage 4: dashboard, trace view, Excel export/import, nightly backups, weekly
> digest, and Windows service instructions.

## Try it in the browser (GitHub Codespaces)

No install needed. This is for testing only: the database lives in the codespace and is
lost when the codespace is deleted.

1. On the repository page on GitHub, switch to the branch you want to test.
2. Click **Code → Codespaces → Create codespace on <branch>**.
3. Wait for the setup to finish (about 2-3 minutes the first time: install and build).
   The tracker then starts by itself, and the terminal shows the temporary passwords.
4. Open the **PORTS** tab and click the globe icon next to port **8080**. If a browser tab
   opened automatically, use that.
5. Sign in as Oscar with his temporary password and choose a new one.

To let colleagues try it, right-click port 8080 → **Port visibility → Public** and send them
the address. They still need to sign in. Set it back to Private when you're done.
Stop the codespace when you're not using it, so it doesn't use your free monthly hours.
**Commands** (in the codespace terminal):

| Command | What it does |
|---|---|
| `bash scripts/codespace-start.sh update` | Get the latest code from GitHub, build and restart. Use this after new changes are pushed. |
| `bash scripts/codespace-start.sh` | Build and restart (for example after the codespace restarts). |

Both keep the test database. After running one, refresh the browser tab. Don't run
`npm start` yourself while the tracker is already running: port 8080 is then in use.

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

## Passwords and users

On the **first start** every user gets a random temporary password. The list is printed in
the server window and saved to `data/initial-passwords.txt`. Hand each person their password;
they must choose their own at first sign-in. Delete the file once everyone has signed in.

**Adding people:** the manager opens **Users** in the app, fills in the name (and optionally
email and role), and presses *Add user*. A temporary password is shown once. Leave the
password box empty to have one generated. *Reset password* works the same way. Users are
never deleted; set them inactive instead so their history stays.

**From the server PC** (for example if the manager password is lost):

```
npm run user -- list
npm run user -- add "Name" --role designer --email name@company.com
npm run user -- reset "Oscar"
npm run user -- deactivate "Name"
```

## Development

```
npm run dev          # API on :8080 with reload
npm run dev:client   # UI on :5173 (proxies /api to :8080)
```

## How reviews and escalation work

**Reviews.**
1. To ask for a review of an iteration, raise a flag of type *Review* for the reviewer.
2. The reviewer opens the flag and gives an outcome: **Approved**, **Approved with comments**
   or **Changes needed**. They add their comments, then close the review.
3. "Changes needed" notifies the iteration author and the consideration owner.

**Closing an iteration.**
- Only the **consideration owner** (or a manager) can close an iteration.
- They can close it only when **every Review flag on it is closed and approved**. FYI and
  Action flags don't block closing.
- A manager can close it anyway, but must give a reason. The reason is shown on the
  iteration and kept in its history.
- A closed iteration is read-only until a manager reopens it.

**Escalation to the managers.** The managers are notified when:
- the assignee or the raiser presses **Escalate to manager** on a flag (with a reason). A
  manager records the decision with *Resolve escalation*;
- an open flag is **3 days past its due date** (once per flag; set `overdueEscalationDays`
  in config.json to change it);
- a review comes back **Changes needed** for the second time on the same consideration;
- an iteration is **closed with verdict Fail**.

## Configuration

Optional `config.json` next to `package.json`:

```json
{
  "port": 8080,
  "appUrl": "http://192.168.1.20:8080",
  "smtp": { "host": "mail.example.local", "port": 25, "from": "tracker@example.local" }
}
```

With `smtp` set, every in-app notification is also emailed to users who have an email
address (set in **Users**), with a link to the record. `appUrl` is the address used in those
links. Optional `smtp` fields: `secure`, `user`, `pass`.

## How it works

| Area | Where |
|---|---|
| Schema and migrations | `server/src/db/migrations.ts` |
| Initial set-up data | `server/src/db/seed.ts` |
| ID generation (race-free, never reused) | `server/src/ids.ts` |
| Business rules: create/update, parent/origin links, notifications | `server/src/services/records.ts` |
| Who may edit what | `server/src/permissions.ts` |
| Audit log, follows, notifications, live events | `server/src/context.ts` |
| REST routes | `server/src/routes/*.ts`, `server/src/auth.ts` |
| User and password helpers, console command | `server/src/services/users.ts`, `server/src/cli.ts` |
| Front end (React + Vite) | `client/src/` |

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
