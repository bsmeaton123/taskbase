@AGENTS.md

# taskbase

Internal Redbooth-style task manager. See README.md for setup and structure.

## Conventions

- Next.js 16: read `node_modules/next/dist/docs/` before using an API you're unsure of.
  Mutations are Server Actions in `src/server/actions/`, wrapped in `run()` from
  `src/server/action-utils.ts`, which returns `{ ok, data | error }` and calls `refresh()`.
  Client code calls them through `perform()` (src/components/app-context.tsx), which toasts errors.
- Every action must check access with `requireActionUser()` plus `assertWorkspaceAccess` /
  `assertTaskAccess` (src/lib/access.ts). Every query in `src/server/queries.ts` must be
  scoped to the viewer's workspace memberships.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and `npm run db:migrate`.
  Production applies migrations with `scripts/migrate.mjs` (runtime deps only).
- Raw SQL subqueries must use explicit table aliases (`"tasks"."id"`): Drizzle leaves column
  names unqualified in single-table selects, which silently changes what `"id"` refers to.
- Templates are workspaces with `is_template = true`; exclude them from personal views
  (sidebar, My tasks, search). All copying goes through `copyTasks` in `src/server/copy.ts`.
- Deleting tasks goes through `trashTasks` in `src/server/trash.ts` (never `db.delete(tasks)`), so
  they can be restored for 30 days. A new table that references tasks must be added to the
  snapshot and restore there, and a new NOT NULL column on those tables needs existing
  `trashed_tasks.snapshot` rows backfilled in its migration.
- Attachments: upload/download via `src/app/api/attachments`, bytes via `src/lib/storage.ts`.
  Email goes through `sendEmail` in `src/lib/email.ts`; notification emails are queued in
  `notify()` with `after()`.
- AI (Claude via `@anthropic-ai/sdk`): calls go through `src/server/ai/client.ts`
  (`aiStructured` for JSON via zod, `aiStreamText` for streamed markdown), which enforce the
  per-person quota and record `ai_usage`. Prompts live in `src/server/ai/prompts.ts` (keep them
  free of dates and per-request data); context builders in `src/server/ai/context.ts` must be
  scoped to the viewer like queries are, and wrap data in tags the prompt treats as data.
  Don't send `temperature`/`top_p`/`top_k`, `budget_tokens` or forced `tool_choice`: the
  model rejects them. AI buttons show unless `AI_ENABLED=false` (`aiVisible()`, `useApp().ai`); without a key
  (`aiEnabled()` false) they stay visible and calls fail with `AI_NOT_CONNECTED` (`src/lib/ai-messages.ts`). Passive AI (like
  smart defaults while typing) checks `aiEnabled()` and stays silent instead.
  Test locally with `npm run ai:mock` plus `ANTHROPIC_BASE_URL=http://127.0.0.1:3999`.
- Every `<form>` has `method="post"`: a submit before hydration otherwise falls back to GET and
  puts what was typed (passwords included) into the URL, history and server logs.
- Dialogs opened from dropdown menus rely on `onFocusOutside` being prevented in
  `components/ui/dialog.tsx`; keep that.
- Styling: Tailwind v4 with tokens in `src/app/globals.css` (bg, surface, text, muted, subtle,
  accent, danger, success, warning). One accent color. Radius: controls `rounded-md`,
  surfaces `rounded-[10px]`. Icons: `@phosphor-icons/react/ssr` only. No em dashes in UI copy.
- Dev server runs on port 3100 (`npm run dev`); port 3000 is used by another project.
- Checks before finishing: `npm run typecheck && npm run lint && npm test && npx next build`.
