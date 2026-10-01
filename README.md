# taskbase

An internal task manager for the team, built as a Redbooth replacement.

- **Workspaces** with members, owners, colours (a palette or your own), archive and delete
- **Task lists** inside each workspace, as a **list view**, a drag-and-drop **board**, or a
  **Gantt timeline** (drag bars to reschedule, arrows show what waits for what)
- **Tasks**: status (Open, In progress, On hold, Resolved, Rejected), **assignees** (one
  person or several), start and due dates, **tags**,
  urgent flag, description, short links (`/t/142`)
- **Subtasks** with their own assignee and due date, drag to reorder
- **Repeating tasks**: every day, week, month or year, on chosen weekdays or a day of the
  month, with an optional end date; completing one creates the next
- **Waiting for**: mark a task as blocked by another, with a nudge when it's unblocked
- **Select several tasks** to complete, assign, tag, re-date, move or delete them together
- **Trash**: deleted tasks (with their subtasks, comments, files and history) can be restored
  for 30 days, straight from the Undo button or from the workspace's Trash page
- **Comments** with `@mentions`, links and file attachments (paste or drop images), plus a
  full activity history on every task
- **Files** on every task, with image previews
- **Templates**: save any workspace as a template, start new workspaces from one (with due
  dates shifted to a new start date), duplicate workspaces, lists and tasks, move tasks
  between workspaces
- **Redbooth import**: an admin connects Redbooth and picks projects; each becomes a workspace
  with its lists, tasks, subtasks, comments, files, assignees and followers, matched to people
  by email. Projects are only imported once, and nothing changes in Redbooth.
- **CSV import** for bringing tasks over from Asana, Trello or a spreadsheet
- **Email in**: every workspace has its own email address. Forward or CC an email to it and it
  becomes a task, files included, assigned to whoever sent it. See [Email in](#email-in).
- **My tasks** across all workspaces, grouped by Overdue, Today, Tomorrow, Next 7 days, Later,
  plus **Updates**: what other people changed or said on tasks you follow, to dismiss or clear
- **Team**: everyone's open tasks by person, across the workspaces you share
- **Morning reminder** email of what's overdue or due today (per-person, off by choice)
- **Inbox** for assignments, mentions, comments and status changes on tasks you follow, plus
  optional **email notifications** (per-person setting)
- **Search** across titles, descriptions, subtasks, comments and tags
- **People admin**: invite links (emailed when SMTP is set up), admins, temporary passwords,
  deactivating leavers; self-service **password reset** by email
- **AI assistant** (optional, powered by Claude): catch-ups, notes to tasks, plain-English
  quick add, status reports, subtask and workspace plans, Ask, early warnings, duplicate
  checks and file summaries. See [AI features](#ai-features).
- Light and dark mode, works on phones

## Stack

Next.js 16 (App Router, Server Actions), React 19, Tailwind CSS 4, Postgres with
Drizzle ORM, Better Auth (email and password, optional Google sign-in), dnd-kit,
Radix primitives, Phosphor icons.

## Run it locally

Requirements: Node 22+ and a Postgres database.

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run db:migrate           # create the tables
npm run db:seed              # optional: demo workspaces, tasks and people
npm run dev                  # http://localhost:3100
```

The demo accounts all end in `@digibooth.test`; the admin is `amara@digibooth.test` and
the shared demo password is `DEMO_PASSWORD` in `src/db/seed.ts`. Reset the demo data with
`npm run db:seed -- --reset`.

The **first account created becomes the admin** (set `ADMIN_EMAIL` so only you can claim it
on a fresh deploy). After that, sign-up is **invite-only**: admins create single-use invite
links from **People** (account menu, bottom left) and send them over Slack or email. If Google
sign-in is configured with `ALLOWED_EMAIL_DOMAINS`, people from those domains can also join
by signing in with Google, no invite needed.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Random secret, `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public URL of the app, e.g. `https://tasks.yourcompany.com` |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated, e.g. `yourcompany.com`. Only these emails can have accounts; Google sign-in from these domains needs no invite. |
| `ADMIN_EMAIL` | Recommended. Only this address can create the first (admin) account. |
| `OPEN_SIGNUP` | `true` lets anyone with an allowed-domain email sign up with a password, no invite. Off by default because passwords don't prove email ownership. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Shows "Continue with Google" (Google Workspace sign-in). Redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `SMTP_URL` | Optional. Turns on email (notifications, invites, password reset), e.g. `smtps://user:pass@smtp.example.com:465`. Without it, emails are printed to the server log in development and skipped in production. |
| `EMAIL_FROM` | Sender for emails, e.g. `taskbase <tasks@yourcompany.com>` |
| `UPLOAD_DIR` | Optional. Store attachments on disk here instead of in Postgres (use a persistent volume). |
| `MAX_UPLOAD_MB` | Largest allowed attachment. Default `10`. On Vercel, requests are capped at 4.5 MB. |
| `DEFAULT_TIMEZONE` | The team's time zone, e.g. `Europe/London`. Used for the morning reminder and before a browser reports its own zone. Defaults to `UTC`. |
| `REMINDER_HOUR` | Local hour (0 to 23) the morning reminder goes out. Default `8`. Set `REMINDER_DRY_RUN=true` to log the emails instead of sending, or `SCHEDULER=false` to turn background jobs off. |
| `DOMAIN`, `POSTGRES_PASSWORD` | Docker deployment: the public domain (Caddy gets its HTTPS certificate) and the bundled database's password. |
| `SLACK_ALERTS_WEBHOOK_URL` | Optional. Slack incoming webhook for server errors and failed backups. |
| `BACKUP_TIME`, `BACKUP_TZ`, `BACKUP_KEEP_DAYS`, `BACKUP_REMOTE` | Docker deployment: nightly database backups kept on the server, plus an optional off-site copy of dumps and files (any rclone remote). See [deploy/HOSTINGER.md](deploy/HOSTINGER.md#backups). |
| `REDBOOTH_CLIENT_ID`, `REDBOOTH_CLIENT_SECRET` | Optional. Lets admins sign in to Redbooth to import projects (People, then Import from Redbooth). Register an app in Redbooth with the callback URL `<BETTER_AUTH_URL>/api/redbooth/callback`. Without them, an admin can paste a Redbooth access token instead. For local testing, `npm run redbooth:mock` plus `REDBOOTH_API_URL=http://127.0.0.1:3998/api/3` and `REDBOOTH_OAUTH_URL=http://127.0.0.1:3998/oauth2`. |
| `INBOUND_EMAIL_ADDRESS` | Optional. Turns on [Email in](#email-in): the mailbox workspace addresses are built on, e.g. `tasks@yourcompany.com` gives `tasks+<key>@yourcompany.com`. |
| `INBOUND_IMAP_URL` | How email in reads that mailbox, e.g. `imaps://tasks%40yourcompany.com:app-password@imap.gmail.com:993` (URL-encode the user and password). Also `INBOUND_IMAP_MAILBOX` (default `INBOX`), `INBOUND_IMAP_DONE_MAILBOX` (where handled emails go, default `Processed`) and `INBOUND_POLL_SECONDS` (default `60`). |
| `INBOUND_EMAIL_SECRET` | Instead of IMAP: lets a mail service post incoming emails to `/api/inbound-email`. Random secret, `openssl rand -hex 24`. |
| `ANTHROPIC_API_KEY` | Optional. Connects the [AI features](#ai-features). Without it the AI buttons still show, and using one explains that AI isn't connected yet. |
| `AI_MODEL` | Claude model to use. Defaults to `claude-opus-5-5`. |
| `AI_HOURLY_LIMIT` | AI requests allowed per person per hour. Default `60`. |
| `AI_ENABLED` | Set to `false` to switch AI off and hide every AI button. |
| `AI_DISABLE_FALLBACKS` | Set to `true` to stop refused requests being retried on Anthropic's fallback model. |

## AI features

Set `ANTHROPIC_API_KEY` and these work (without it they show, but explain that AI isn't connected yet). Nothing is created without someone reviewing it first.

| Feature | Where |
| --- | --- |
| **Catch me up**: a short personal digest of what needs you today | My tasks |
| **Thread catch-up**: where a long task stands, open questions, next steps | Task panel, above comments |
| **Notes to tasks**: paste meeting notes or an email, review the action items, create them | Workspace `...` menu |
| **Quick add**: "Ask Priya to review the homepage copy by Friday" becomes a filled-in task | Sidebar, or press `Q` |
| **Status report**: a draft weekly update (7, 14 or 30 days) to copy into Slack or email | Workspace `...` menu |
| **Suggest subtasks** for a task, and **Plan it with AI** for a whole new workspace | Subtasks header; New workspace |
| **Ask**: questions about your work, answered with links to the tasks | Sidebar, Ask |
| **Risks and health**: overdue, stalled, unowned and overloaded work, plus a short briefing | Workspace `...` menu; "Heads up" on My tasks |
| **Smart defaults**: warns about similar open tasks and suggests list, assignees and due date | New task dialog |
| **Summarise a file**: what a PDF, image or text file says and what it means for the task | Sparkle button on a task's files |

Things to know:

- **Data**: task titles, descriptions, comments and files are sent to Anthropic's API when
  someone uses a feature. Each request only includes what that person can already see. The
  duplicate warning and the risk list are plain rules and never call the API.
- **Cost**: each use is one request (Ask may take a few). Usage is recorded per person in the
  `ai_usage` table, and `AI_HOURLY_LIMIT` caps it.
- **Trying it without a key**: `npm run ai:mock` starts a local stand-in for the API with canned
  answers. Run the app with
  `ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock npm run dev`.

## Email in

Each workspace has its own address, shown in its settings (and under **Copy email address** in
the workspace `...` menu). Forward an email to it, or CC it on a thread, and the email becomes a
task:

- **Title** from the subject (`Fwd:` and `Re:` dropped), **description** from the message,
  **files** attached (up to `MAX_UPLOAD_MB` each, 20 per email; logos and other images
  embedded in the email are left out, and anything too big is listed in the description).
- It goes to the bottom of the workspace's **first list**, **assigned to whoever sent it**, so
  nothing arrives unowned. Hand it on from there.

**Who can email in**: people with an account, who are members of that workspace, sending from
the email address on their account. Anything else is refused. The address contains a random key
(about 90 bits), which is what keeps strangers out, so treat it like a password: workspace owners
can replace it with **Get a new address**, and the old one stops working straight away. Emails
that fail the receiving server's DMARC check (a forged sender) are refused too.

**Refusals**: every email that reaches an address is listed under **Recent emails** in the
workspace settings with what happened to it. People with an account also get a short email
explaining why theirs wasn't added; strangers never get a reply. Automatic replies (out of
office, bounces, mailing lists) are skipped silently, and the same email is never added twice.
The list keeps 90 days.

### Connecting a mailbox

Pick one of these. Either way, set `INBOUND_EMAIL_ADDRESS` to the mailbox's address. It must
accept **plus addresses** (`tasks+anything@`), which Gmail and most hosts do.

**IMAP (Google Workspace and most mail hosts).** Create a mailbox just for this, like
`tasks@yourcompany.com`. For Google Workspace: turn on 2-Step Verification for that account,
create an **app password**, and set
`INBOUND_IMAP_URL=imaps://tasks%40yourcompany.com:<app password, no spaces>@imap.gmail.com:993`.
Other hosts work the same way with their IMAP server name. The app checks the inbox every minute
and moves each email it has dealt with into `Processed` (created if missing). If the mailbox
can't be reached, the alert goes to `SLACK_ALERTS_WEBHOOK_URL`. Microsoft 365 no longer allows
password sign-in over IMAP, so use the webhook route below with it.

**Webhook (a mail service posts each email).** Set `INBOUND_EMAIL_SECRET` and have the service
`POST` the raw email to `https://<your domain>/api/inbound-email`, authenticated with
`Authorization: Bearer <secret>`, or with the secret as the basic-auth password
(`https://any:<secret>@<your domain>/api/inbound-email`) where only a URL can be set. It also
accepts a form with the raw email in an `email` field (SendGrid's "post the raw, full MIME
message") or `body-mime` (Mailgun: use the URL ending in `/api/inbound-email/mime`). With
Cloudflare Email Routing, send everything for a subdomain (say `in.yourcompany.com`, with
`INBOUND_EMAIL_ADDRESS=tasks@in.yourcompany.com`) to an Email Worker like this:

```js
export default {
  async email(message, env) {
    const res = await fetch("https://tasks.yourcompany.com/api/inbound-email", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.INBOUND_EMAIL_SECRET}`, "X-Envelope-To": message.to },
      body: await new Response(message.raw).arrayBuffer(),
    });
    if (!res.ok) message.setReject(`The task manager couldn't take this email (${res.status})`);
  },
};
```

**Trying it locally**: set `INBOUND_EMAIL_ADDRESS=tasks@digibooth.test` and an
`INBOUND_EMAIL_SECRET`, copy a workspace's address from its settings, then post any `.eml`
file sent to it:
`curl -H "Authorization: Bearer $INBOUND_EMAIL_SECRET" --data-binary @message.eml http://localhost:3100/api/inbound-email`.

## Deploying

It's a standard Next.js app with a Postgres database, so any of these work:

- **Docker on one server (e.g. a Hostinger VPS)**: `cp .env.example .env`, fill it in, then
  `docker compose up -d --build`. This runs Postgres, the app, Caddy (automatic HTTPS for
  `DOMAIN`) and nightly backups, applies migrations on start-up, and keeps uploads on a
  volume. Step-by-step guide: [deploy/HOSTINGER.md](deploy/HOSTINGER.md).
- **Vercel + a hosted Postgres (Neon, Supabase…)**: import the repo, set the env vars, and run
  `DATABASE_URL=… npm run db:migrate:prod` once per release that adds a migration.
  Attachments are stored in Postgres there (leave `UPLOAD_DIR` unset).
- **Any Node host**: `npm run build`, then `node scripts/migrate.mjs && node .next/standalone/server.js`
  (copy `.next/static` and `public` next to the standalone server, as the Dockerfile does).

`GET /api/health` returns `{"ok":true}` when the app can reach the database. Set
`SLACK_ALERTS_WEBHOOK_URL` to get server errors and failed backups posted to a Slack channel.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3100 |
| `npm run build` / `npm start` | Production build and server |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (dev, uses drizzle-kit) |
| `npm run db:migrate:prod` | Apply migrations with runtime dependencies only (production) |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Demo data (refuses to run on a non-empty database without `--reset`) |
| `npm run ai:mock` | Local stand-in for the Claude API, for trying AI features without a key |
| `npm test` | Unit tests |
| `npm run typecheck` / `npm run lint` | Static checks |

## How it's organised

```
src/
  app/(auth)/            sign-in, sign-up, forgot-password, reset-password
  app/(app)/             signed-in pages: my-tasks, team, inbox, search, ask, workspaces,
                         w/[id] (list, board, gantt), w/[id]/settings, t/[number], people, settings
  app/invite/[token]/    invite links (sets a cookie, then sign-up)
  app/api/health/        {"ok":true} when the database is reachable
  components/            UI; task-panel/ is the task detail drawer, workspace/ the list, board,
                         gantt and bulk-edit bar
  instrumentation.ts     server start-up: background jobs and Slack error alerts
  db/schema.ts           all tables (Better Auth tables + workspaces, tasks, subtasks, comments…)
  lib/access.ts          who can see and manage which workspace
  lib/storage.ts         attachment storage (Postgres by default, disk with UPLOAD_DIR)
  lib/email.ts           SMTP email; server/notification-emails.ts decides who gets what
  server/queries.ts      read-side data access (always scoped to the viewer)
  server/actions/        Server Actions for every mutation (each checks access)
  server/copy.ts         copying lists/tasks/subtasks for templates and duplicates
  server/recurrence.ts   next occurrence when a repeating task is completed (and undo)
  server/dependencies.ts cycle check and "unblocked" notifications
  server/reminders.ts    the morning reminder email; server/scheduler.ts runs it
  server/ai/             Claude client, prompts and access-scoped context for AI features
  lib/insights.ts        rule-based risk checks (overdue, stalled, overloaded…)
  app/api/ai/            streaming routes for summaries, reports and Ask
  app/api/attachments/   upload and download routes (access-checked)
```

Changes show up for other people within about 20 seconds (and immediately when they switch
back to the tab); there's no websocket server to run.
