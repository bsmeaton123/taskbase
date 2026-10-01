# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff at a digital agency of 10 to 25 people (web design and development, SEO and marketing, plus the admin side such as invoicing) who run client jobs day to day. Everyone is internal: there are no client or guest logins. Each person works through their own tasks across several client workspaces, hands work to colleagues, and checks what has changed on the jobs they're involved in. An admin manages people, invites and workspaces.

## Product Purpose

taskbase is the agency's own task manager, replacing Redbooth. Work is organised into workspaces (one per client or stream of work, such as "Harbour & Finch - Website" or "To be invoiced"), each with task lists, tasks, subtasks, comments and files.

Success means four things, all confirmed as priorities:

- **Nothing slips:** due dates, follow-ups, handovers and blocked work don't get lost, and overdue work is obvious.
- **See who's doing what:** workload and progress across people and clients are visible at a glance.
- **Fast to use:** adding and updating tasks takes fewer steps than it did in Redbooth.
- **Own the tool and the data:** no per-seat SaaS bill, and the data lives on the agency's own server.

## Positioning

It is built for one team and owned by that team: self-hosted on the agency's own server, shaped around how they already worked in Redbooth (workspaces per client, task lists, subtasks visible without opening the task, an Updates feed), and carrying over their Redbooth history. It adds what Redbooth lacked for them: repeating tasks, "waiting for" links between tasks, a Gantt view, per-person Team pages, a trash with restore, and an optional AI assistant.

## Operating Context

- Used in desktop browsers through the working day, and on phones away from the desk.
- The team chats in **Slack**; Slack is the chat integration to build. Email carries notifications, invites, password resets and a morning reminder of overdue and due-today work.
- The agency is moving off Redbooth: a CSV import exists, and an importer using the Redbooth API is being built (the team has API access).
- Hosted on a single **Hostinger VPS** with Docker Compose (Caddy for HTTPS, nightly backups), not serverless.
- Rituals the product supports: My tasks (To do, Completed, Updates), the Inbox for assignments and mentions, Team pages for workload, the morning reminder email.

## Capabilities and Constraints

- Confirmed: workspaces with members and owners, task lists, tasks (status, assignees, start and due dates, tags, urgent flag, description), subtasks, comments with @mentions and files, activity history, templates and duplication, bulk edit, repeating tasks, waiting-for links, list, board and Gantt views, My tasks, Team, Inbox, search and a Cmd+K jump palette, trash with 30-day restore, CSV import, invite-only accounts with admin controls, optional AI features (Claude) that stay hidden when no API key is set.
- Out of scope by decision: **time tracking** and **guest or client access**.
- Deactivating a person keeps them on the tasks they're assigned to, so their work stays visible; they just can't be newly assigned.
- Terminology: workspace, task list, task, subtask, waiting for, tags, templates, My tasks, Team, Inbox, Updates, Trash.
- Copy is British English, plain and direct; no em dashes in UI copy.
- Still undecided: the domain, the SMTP provider, whether Google sign-in is used, and the final product name.

## Brand Commitments

- **Name:** "taskbase" is a working name and may change, so it must stay easy to swap (it lives in `src/components/brand.tsx` and `src/lib/brand-icon.ts`; the package and Docker project are also named taskbase).
- **Logo:** the taskbase mark supplied by the user, implemented in `src/lib/brand-icon.ts` and `src/app/icon.svg`.

## Evidence on Hand

This is an internal tool with no public marketing surface. Real data is the agency's Redbooth account, to be imported. The demo data in `src/db/seed.ts` (Website relaunch, Harbour & Finch onboarding, Operations, and people at `@digibooth.test`) is fictional and only for development. There are no customers, testimonials or metrics to cite, and none should be invented.

## Product Principles

1. **Nothing relies on memory.** Dates, blockers, handovers and changes surface on their own through reminders, overdue states, the Inbox and Updates.
2. **Workload is visible to everyone.** Anyone can see who is on what across clients without asking.
3. **Speed over ceremony.** Common actions take one click or one keystroke and edit in place; no forms where inline editing works.
4. **Familiar first, better second.** Keep the patterns the team already knows from Redbooth, and improve where Redbooth was slow or missing something.
5. **Theirs to keep.** Self-hosted, exportable and restorable, with nothing depending on a third-party service staying around.
