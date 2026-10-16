# Design Iteration Tracker

A web app for the mechanical design team that replaces the Excel tracker. It records design
**considerations** (requirements and target metrics per domain), the **iterations** made on them
(CAD, analysis, simulation, verdict), and the **flags** they raise for other people and domains
(reviews, FYIs, actions). Every iteration and every hand-over is traceable.

It runs on one Windows PC in the office. Colleagues use it from their browsers at
`http://<pc-address>:8080`. Nothing is exposed outside the office network.

---

## Contents

1. [Install on the office PC](#1-install-on-the-office-pc)
2. [Start, stop and run at start-up](#2-start-stop-and-run-at-start-up)
3. [How colleagues connect](#3-how-colleagues-connect)
4. [First sign-in and adding users](#4-first-sign-in-and-adding-users)
5. [Updating](#5-updating)
6. [Backups and restore](#6-backups-and-restore)
7. [Teams alerts and email](#7-teams-alerts-and-email)
8. [Excel export and import](#8-excel-export-and-import)
9. [How the tracker works](#9-how-the-tracker-works)
10. [Trying it in GitHub Codespaces](#10-trying-it-in-github-codespaces)
11. [Troubleshooting](#11-troubleshooting)
12. [For developers](#12-for-developers)

---

## 1. Install on the office PC

You need a Windows PC that stays on during working hours, preferably with a fixed IP address
(ask IT to reserve one).

1. Install **Node.js 22 LTS** from <https://nodejs.org>. Use the default options; this installs it
   for all users.
2. Install **Git for Windows** from <https://git-scm.com>.
3. Open **Command Prompt** and download the tracker:
   ```
   cd C:\
   git clone -b claude/great-thompson-fy6ag3 https://github.com/nisathav/DesignIterationTracking-.git DesignTracker
   ```
   You can also download the ZIP from GitHub and unpack it to `C:\DesignTracker`.
4. Optional: copy `config.example.json` to `config.json` and edit it (port, address used in links,
   email server).

Everything the tracker stores lives in `C:\DesignTracker\data` (database and uploaded files).
Backups go to `C:\DesignTracker\backups`.

## 2. Start, stop and run at start-up

**Recommended: run in the background, starting with the PC.** In `C:\DesignTracker\scripts\windows`,
right-click **`setup-windows.bat` → Run as administrator**. It:

- installs and builds the app (the first time takes a few minutes);
- opens port 8080 in Windows Firewall for the office network only;
- creates a task that starts the tracker when the PC starts, without anyone logged in, and
  restarts it if it stops;
- starts the tracker now and shows the address colleagues should use.

Output goes to `C:\DesignTracker\logs\tracker.log`. Also set the PC to never sleep
(**Settings → System → Power**).

- **Stop:** open Task Scheduler, find *Design Iteration Tracker*, then **End**. Or run
  `schtasks /End /TN "Design Iteration Tracker"` as administrator.
- **Start again:** **Run** in Task Scheduler, or restart the PC.
- **Remove the task and firewall rule:** run `setup-windows.bat remove` as administrator. Data is kept.

**Alternative: start in a window.** Double-click **`start.bat`**. The tracker runs while that window
is open and stops when it is closed. Open the firewall once, as administrator:

```
netsh advfirewall firewall add rule name="Design Iteration Tracker" dir=in action=allow protocol=TCP localport=8080 profile=domain,private
```

## 3. How colleagues connect

Open a browser and go to **`http://<pc-address>:8080`**, for example `http://192.168.1.25:8080`,
or by PC name: `http://DESIGN-PC01:8080`. The setup script and the server's first log lines show
the address. Bookmark it. The tracker works in Chrome and Edge on desktops and tablets.

If colleagues can't connect:
- check the PC's network is set to *Private* or *Domain*, not *Public*;
- check the firewall rule exists;
- check the PC is awake.

## 4. First sign-in and adding users

On the first start, every user gets a **temporary password**:

- With `start.bat`, they are shown in the window.
- With the background task, they are in `logs\tracker.log`.
- In both cases they are saved to `data\initial-passwords.txt`.

Hand each person their password. They choose their own at first sign-in. Delete the file once
everyone has signed in.

**Adding people:** a manager opens **Admin → Users**, fills in the name, work email and role, and
presses *Add user*. A temporary password is shown once; leave the password box empty to generate
one. *Reset password* works the same way. Users are never deleted; set them inactive instead.

**Lost the manager password?** On the tracker PC, in `C:\DesignTracker`:
```
npm run user -- reset "Oscar"
npm run user -- list
npm run user -- add "Name" --role manager
```

## 5. Updating

Double-click **`update.bat`**, as administrator if the tracker runs as a background task. It stops
the tracker, gets the latest version from GitHub, rebuilds and restarts. The database, uploads and
backups are kept. The database is upgraded automatically on start.

## 6. Backups and restore

- **Automatic:** every night from 02:00 the database is copied to `backups\tracker-YYYY-MM-DD.db`,
  and uploaded files are copied to `backups\uploads`. If the PC was off at 02:00, the copy is made
  as soon as the tracker runs. Copies older than 30 days are deleted.
- **On demand:** **Admin → Backups & digest → Back up now.**
- **Keep a copy elsewhere.** Backups on the same PC don't help if its disk fails. Copy the
  `backups` folder to a network drive, for example with a nightly Task Scheduler job:
  `robocopy C:\DesignTracker\backups \\fileserver\design\tracker-backups /MIR`.

**Restore a backup:**
1. Stop the tracker (see section 2).
2. In `C:\DesignTracker\data`, rename `tracker.db` to `tracker-broken.db`, and delete
   `tracker.db-wal` and `tracker.db-shm` if they exist.
3. Copy the backup you want, for example `backups\tracker-2026-10-15.db`, to `data\tracker.db`.
4. If uploads were lost, copy `backups\uploads\*` into `data\uploads`.
5. Start the tracker. Everything after the time of that backup is gone.

## 7. Teams alerts and email

The app's own notifications (bell icon with live pop-ups) are always on. Two optional channels:

**Teams channel.** Each flag is posted to one channel and @mentions the person it is for, so they
get a Teams notification. Each post has an **Open in tracker** button.
1. In Teams, on the channel: **⋯ → Workflows →** "Post to a channel when a webhook request is
   received". Copy the web address it gives you.
2. In the tracker: **Admin → Teams alerts**. Paste the address, check the tracker address used for
   the button, tick **Post alerts to Teams**, then **Save** and **Send test message**.
3. Make sure everyone has their work email (their Microsoft 365 sign-in) in **Admin → Users**.

Posted: flag assigned or reassigned, review outcome, flag closed, escalation and its decision,
flag 3 days overdue, iteration closed with Fail. Each of these can be switched off. The tracker PC
needs outbound internet access for this; nothing is opened to it from outside.

**Email.** Add an `smtp` section to `config.json` (see `config.example.json`) and restart. Every
notification, including the weekly digest, is then also emailed to users who have an email
address. `appUrl` sets the address used in the email links.

**Weekly digest.** Every Monday from 07:00, each person gets a summary of the past week in the
domains and considerations they follow, plus what is waiting on them. It appears under the bell,
and is also emailed if email is set up.

## 8. Excel export and import

**Export (managers):** **Admin → Export to Excel.** Choose domains, all or only open
considerations, and optionally comments and the change history. The workbook has these sheets:
Summary, Considerations, Iterations, Flags, Comments, Change history and Setup. Rows are coloured
by domain, verdicts are green / amber / red, and IDs link back to the tracker.

**Import (managers):** **Admin → Import from Excel.** Use the same layout as the export (or the
original tracker's sheets). Press **Check file** first; nothing is saved, and every problem is
listed by sheet and row. Then press **Import**.
- Rows whose ID already exists are skipped and never changed.
- Rows without an ID get the next free ID.
- If any row has a problem, nothing is imported.
- Domains, sub-systems and people must exist first.

To move data from one tracker to another, export everything from the first and import the file
into the second.

## 9. How the tracker works

**Records and IDs.** IDs are created by the server, never change and are never reused.
Nothing is deleted; records are set to *Withdrawn* instead.
- **Consideration** `SH-C01`: a requirement or target in a domain and sub-system, with an owner.
  Its origin is either *root* or the flag that led to it.
- **Iteration** `SH-C01-I03`: one design loop: design input, CAD, analytical and simulation results,
  evidence, verdict (Pass / Conditional Pass / Fail), status and next step. Its parent is the previous
  iteration; for the first iteration, it is the consideration's origin flag.
- **Flag** `SH-C01-I03-F1`: a Review, FYI or Action for one person, with an affected domain and a
  due date. The assignee responds and closes it. They can also create a new consideration from it,
  which records the link both ways.

**Reviews and closing iterations.**
- The reviewer gives a review outcome: **Approved**, **Approved with comments** or
  **Changes needed**. A review can't be closed without one.
- Only the **consideration owner** (or a manager) closes an iteration, and only when every review on
  it is closed and approved. A manager can close it anyway with a reason, which is recorded.
- A closed iteration is read-only until a manager reopens it.

**Who may edit:**
- A consideration: its owner, its creator, or a manager.
- An iteration: its author, the consideration owner, or a manager.
- A flag's request: whoever raised it, or a manager.
- A flag's response: the assignee, or a manager.

Everyone can read everything and comment. If two people edit the same record, the second save is
refused with a message and their changes are kept on screen.

**Escalation.** **Escalate to manager** on a flag notifies all managers; a manager records the
decision. Managers are also notified automatically when:
- a flag is 3 days overdue;
- "Changes needed" comes back twice on the same consideration;
- an iteration is closed with Fail.

**Pages:**

| Page | What it is for |
|---|---|
| Activity | Live team feed by day and consideration (click to see the history), with My items beside it |
| My items | Flags assigned to you, iterations ready to close, changes needed, and flags you raised |
| Dashboard | Counts per domain and per person, and weekly activity; every number opens the list behind it |
| Board | One column per domain with its open considerations |
| Considerations / Iterations / Flags | Lists with filters and sorting |
| Consideration page | Target, status, iteration timeline with flags, comments, attachments, history, and **Trace** |
| Trace | Diagram of the whole chain across domains: consideration, iterations, flags and the considerations they led to |
| Admin (managers) | Users, Domains & lists, Teams alerts, Export, Import, Backups & digest |

**Configuration** (`config.json`, all optional):

| Key | Default | Meaning |
|---|---|---|
| `port` | 8080 | Port the tracker listens on |
| `appUrl` | `http://localhost:8080` | Address used in email links |
| `overdueEscalationDays` | 3 | Days past due before managers are told |
| `smtp` | none | `host`, `port`, `secure`, `user`, `pass`, `from` for email |
| `dbFile`, `uploadDir`, `backupDir` | `./data/...`, `./backups` | Where data and backups are kept |

## 10. Trying it in GitHub Codespaces

For testing without installing anything. The data lives in the codespace and is lost when it is
deleted.

1. On GitHub, switch to the branch, then **Code → Codespaces → Create codespace**.
2. Wait for the setup (2–3 minutes). The terminal shows the temporary passwords.
3. **PORTS** tab → globe icon next to port 8080.
4. To let others try it: right-click port 8080 → **Port visibility → Public**. Set it back
   afterwards.

After new changes are pushed, run `bash scripts/codespace-start.sh update` and refresh the page.

## 11. Troubleshooting

| Problem | What to do |
|---|---|
| Colleagues can't open the page | Check the firewall rule, that the network profile is Private/Domain, and that the PC is awake. Try `http://<ip>:8080` from the PC itself. |
| Page is blank after an update | Refresh with Ctrl+F5. |
| "Port 8080 is in use" | The tracker is already running (background task or another window). |
| Teams test fails | The Teams alerts page shows the reason. Usually the PC has no internet access or the workflow address is incomplete. |
| Someone forgot their password | Admin → Users → Reset password. |
| Need the log | `logs\tracker.log` (background task) or the `start.bat` window. |

## 12. For developers

Stack: Node.js + TypeScript (Fastify), SQLite (better-sqlite3, WAL mode, migrations in
`server/src/db/migrations.ts`), React + TypeScript + Vite, Server-Sent Events for live updates.

```
npm install          # install
npm run build        # compile server and client into dist/
npm start            # serve on http://0.0.0.0:8080
npm test             # run the test suite (vitest)
npm run dev          # API with reload on :8080
npm run dev:client   # UI on :5173, proxying /api to :8080
```

| Area | Where |
|---|---|
| Schema and migrations, initial set-up data | `server/src/db/` |
| ID generation (race-free, never reused) | `server/src/ids.ts` |
| Business rules (create/update, links, reviews, escalation, notifications) | `server/src/services/records.ts` |
| Permissions | `server/src/permissions.ts` |
| Audit log, follows, notifications, live events, Teams queue | `server/src/context.ts` |
| Dashboard and trace | `server/src/insights.ts` |
| Excel export / import | `server/src/export.ts`, `server/src/importer.ts` |
| Backups, weekly digest, overdue check | `server/src/backup.ts`, `server/src/digest.ts`, `server/src/scheduler.ts` |
| Teams alerts, email | `server/src/teams.ts`, `server/src/mailer.ts` |
| REST routes | `server/src/routes/`, `server/src/auth.ts` |
| Front end | `client/src/` |
| Windows scripts | `start.bat`, `update.bat`, `run-service.bat`, `scripts/windows/` |
