/**
 * Demo data for local development.
 *
 *   npm run db:seed            # only runs on an empty database
 *   npm run db:seed -- --reset # wipes everything first
 *
 * Every demo account uses the password below. Never run this in production.
 */
import { config } from "dotenv";
import type { Recurrence } from "../lib/recurrence";
import type { TaskStatus } from "./schema";

config({ path: [".env.local", ".env"] });

export const DEMO_PASSWORD = "digibooth-demo";

async function main() {
  const { hashPassword } = await import("better-auth/crypto");
  const { sql } = await import("drizzle-orm");
  const { db } = await import("./index");
  const s = await import("./schema");
  const { newId } = await import("../lib/id");

  const reset = process.argv.includes("--reset");
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed production.");

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.user);
  if (n > 0 && !reset) {
    console.log("Database already has users. Re-run with --reset to wipe and reseed.");
    process.exit(0);
  }
  if (reset) {
    await db.execute(
      sql`truncate table ${s.notifications}, ${s.activities}, ${s.comments}, ${s.taskFollowers}, ${s.subtasks}, ${s.tasks}, ${s.taskLists}, ${s.workspaceMembers}, ${s.workspaces}, ${s.session}, ${s.account}, ${s.verification}, ${s.user} restart identity cascade`,
    );
  }

  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const ago = (hours: number) => new Date(Date.now() - hours * 3600_000);

  /* People ----------------------------------------------------------------- */
  const hash = await hashPassword(DEMO_PASSWORD);
  const people = [
    { key: "amara", name: "Amara Okafor", role: "admin" },
    { key: "tomasz", name: "Tomasz Wiśniewski", role: "user" },
    { key: "priya", name: "Priya Raman", role: "user" },
    { key: "declan", name: "Declan Byrne", role: "user" },
    { key: "sofia", name: "Sofia Lindqvist", role: "user" },
    { key: "marcus", name: "Marcus Ellery", role: "user" },
  ] as const;
  type Key = (typeof people)[number]["key"];
  const ids = {} as Record<Key, string>;

  for (const p of people) {
    const id = newId();
    ids[p.key] = id;
    await db.insert(s.user).values({
      id,
      name: p.name,
      email: `${p.key}@digibooth.test`,
      emailVerified: true,
      role: p.role,
      createdAt: ago(24 * 40),
    });
    await db.insert(s.account).values({
      id: newId(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: hash,
    });
  }

  /* Helpers ---------------------------------------------------------------- */
  async function workspace(
    name: string,
    color: string,
    description: string,
    owner: Key,
    members: Key[],
  ) {
    const [ws] = await db
      .insert(s.workspaces)
      .values({ name, color, description, createdById: ids[owner], createdAt: ago(24 * 30) })
      .returning();
    await db.insert(s.workspaceMembers).values([
      { workspaceId: ws.id, userId: ids[owner], role: "owner" },
      ...members.map((m) => ({ workspaceId: ws.id, userId: ids[m], role: "member" as const })),
    ]);
    return ws;
  }

  async function lists(workspaceId: string, names: string[]) {
    const rows = await db
      .insert(s.taskLists)
      .values(names.map((name, i) => ({ workspaceId, name, position: (i + 1) * 1024 })))
      .returning();
    return Object.fromEntries(rows.map((r) => [r.name, r.id]));
  }

  const TAG_COLORS: Record<string, string> = {
    Design: "violet",
    Content: "teal",
    "Launch blocker": "red",
    SEO: "amber",
    Finance: "green",
    Equipment: "blue",
    Client: "orange",
  };
  const tagIds = new Map<string, string>();

  let pos = 0;
  async function task(
    workspaceId: string,
    taskListId: string,
    t: {
      title: string;
      by: Key;
      /** Assignee, or several. */
      to?: Key | Key[];
      start?: number;
      due?: number;
      repeat?: Recurrence;
      tags?: string[];
      status?: TaskStatus;
      urgent?: boolean;
      description?: string;
      createdHoursAgo?: number;
      subtasks?: [string, boolean, Key?][];
      comments?: [Key, string, number][];
    },
  ) {
    pos += 1024;
    const createdAt = ago(t.createdHoursAgo ?? 72);
    const closed = t.status === "resolved" || t.status === "rejected";
    const to: Key[] = t.to === undefined ? [] : Array.isArray(t.to) ? t.to : [t.to];
    const [row] = await db
      .insert(s.tasks)
      .values({
        workspaceId,
        taskListId,
        title: t.title,
        description: t.description ?? "",
        status: t.status ?? "open",
        urgent: t.urgent ?? false,
        startDate: t.start === undefined ? null : day(t.start),
        dueDate: t.due === undefined ? null : day(t.due),
        recurrence: t.repeat ?? null,
        position: pos,
        createdById: ids[t.by],
        completedAt: closed ? ago(6) : null,
        createdAt,
      })
      .returning();
    if (to.length)
      await db.insert(s.taskAssignees).values(
        to.map((key, i) => ({
          taskId: row.id,
          userId: ids[key],
          createdAt: new Date(createdAt.getTime() + 60_000 * (i + 1)),
        })),
      );

    await db.insert(s.activities).values({
      workspaceId,
      taskId: row.id,
      actorId: ids[t.by],
      kind: "task_created",
      createdAt,
    });
    for (const [i, key] of to.entries())
      if (key !== t.by)
        await db.insert(s.activities).values({
          workspaceId,
          taskId: row.id,
          actorId: ids[t.by],
          kind: "assigned",
          data: { userId: ids[key], name: people.find((p) => p.key === key)!.name },
          createdAt: new Date(createdAt.getTime() + 60_000 * (i + 1)),
        });
    if (t.status && t.status !== "open")
      await db.insert(s.activities).values({
        workspaceId,
        taskId: row.id,
        actorId: ids[to[0] ?? t.by],
        kind: "status_changed",
        data: { from: "open", to: t.status },
        createdAt: ago(8),
      });

    const followers = new Set<string>([ids[t.by], ...to.map((key) => ids[key])]);

    for (const [i, [title, done, assignee]] of (t.subtasks ?? []).entries()) {
      await db.insert(s.subtasks).values({
        taskId: row.id,
        title,
        done,
        assigneeId: assignee ? ids[assignee] : null,
        position: (i + 1) * 1024,
        completedAt: done ? ago(20) : null,
        createdById: ids[t.by],
      });
    }

    for (const [author, body, hoursAgo] of t.comments ?? []) {
      const encoded = body.replace(/@(\w+)/g, (m, key: string) =>
        key in ids ? `@[${people.find((p) => p.key === key)!.name}](${ids[key as Key]})` : m,
      );
      const [c] = await db
        .insert(s.comments)
        .values({ taskId: row.id, authorId: ids[author], body: encoded, createdAt: ago(hoursAgo) })
        .returning();
      followers.add(ids[author]);
      // Seed the admin's inbox so it isn't empty on first sign-in.
      if (author !== "amara" && (body.includes("@amara") || followers.has(ids.amara))) {
        await db.insert(s.notifications).values({
          userId: ids.amara,
          actorId: ids[author],
          kind: body.includes("@amara") ? "mentioned" : "commented",
          workspaceId,
          taskId: row.id,
          commentId: c.id,
          createdAt: ago(hoursAgo),
        });
      }
    }

    // Following since the task was created, so the seeded history shows under My tasks > Updates.
    await db
      .insert(s.taskFollowers)
      .values([...followers].map((userId) => ({ taskId: row.id, userId, createdAt })))
      .onConflictDoNothing();

    for (const name of t.tags ?? []) {
      const key = `${workspaceId}:${name}`;
      if (!tagIds.has(key)) {
        const [tag] = await db
          .insert(s.tags)
          .values({ workspaceId, name, color: TAG_COLORS[name] ?? "slate" })
          .returning();
        tagIds.set(key, tag.id);
      }
      await db.insert(s.taskTags).values({ taskId: row.id, tagId: tagIds.get(key)! });
    }

    if (to.includes("amara") && t.by !== "amara")
      await db.insert(s.notifications).values({
        userId: ids.amara,
        actorId: ids[t.by],
        kind: "assigned",
        workspaceId,
        taskId: row.id,
        createdAt,
      });
    return row;
  }

  /* Website relaunch -------------------------------------------------------- */
  const web = await workspace(
    "Website relaunch",
    "blue",
    "New marketing site on the new CMS. Target launch is the end of next month.",
    "amara",
    ["tomasz", "priya", "sofia"],
  );
  const wl = await lists(web.id, ["Backlog", "In progress", "Review"]);

  await task(web.id, wl["In progress"], {
    title: "Write copy for the pricing page",
    by: "amara",
    tags: ["Content"],
    to: "priya",
    start: -3,
    due: 1,
    status: "in_progress",
    description:
      "Three plans plus an enterprise row. Keep each plan description under 25 words.\n\nReference: the comparison table in the brand deck, slide 14.",
    subtasks: [
      ["Draft plan names and one-line summaries", true, "priya"],
      ["FAQ section (8 questions)", false, "priya"],
      ["Legal review of refund wording", false, "declan"],
    ],
    comments: [
      ["priya", "First draft is in the shared doc. The enterprise row still needs numbers from @amara.", 20],
      ["amara", "Thanks! I'll send the enterprise numbers over this afternoon.", 18],
      ["sofia", "Could we keep the FAQ collapsed by default on mobile? The page gets long.", 3],
    ],
  });
  await task(web.id, wl["In progress"], {
    title: "Migrate blog posts from WordPress",
    by: "amara",
    tags: ["Content", "SEO"],
    to: ["tomasz", "sofia"],
    start: -2,
    due: 6,
    status: "in_progress",
    subtasks: [
      ["Export posts and media", true, "tomasz"],
      ["Map categories to new tags", true],
      ["Fix embedded video shortcodes", false, "tomasz"],
      ["Spot-check 20 random posts", false, "sofia"],
    ],
    comments: [["tomasz", "About 340 posts moved so far. Videos are the only real problem.", 30]],
  });
  await task(web.id, wl.Backlog, {
    title: "Set up 301 redirects for old URLs",
    by: "tomasz",
    tags: ["SEO", "Launch blocker"],
    to: "amara",
    start: -6,
    due: -2,
    urgent: true,
    description: "Old /news/* paths need to go to /blog/*. The full list of URLs is in the SEO audit.",
    comments: [["tomasz", "@amara this one blocks launch, can you pick it up this week?", 26]],
  });
  const speedAudit = await task(web.id, wl.Backlog, {
    title: "Audit page speed on the current site",
    by: "sofia",
    to: "sofia",
    start: 1,
    due: 3,
  });
  const cookieBanner = await task(web.id, wl.Backlog, {
    title: "Choose a cookie consent banner",
    by: "amara",
    start: 6,
    due: 10,
  });
  await task(web.id, wl.Backlog, { title: "Refresh team photos for the About page", by: "priya" });
  await task(web.id, wl.Review, {
    title: "QA the new navigation on Safari and iOS",
    by: "sofia",
    tags: ["Launch blocker"],
    to: ["amara", "sofia"],
    start: -1,
    due: 0,
    subtasks: [
      ["iPhone 13, Safari", true, "sofia"],
      ["iPad, landscape", false],
      ["macOS Safari 17", false, "amara"],
    ],
    comments: [["sofia", "Found a gap under the sticky header on iPad landscape. Screenshot in the design channel.", 5]],
  });
  await task(web.id, wl.Review, {
    title: "Homepage hero illustration",
    by: "priya",
    tags: ["Design"],
    to: "priya",
    status: "resolved",
  });

  /* Operations --------------------------------------------------------------- */
  const ops = await workspace(
    "Operations",
    "green",
    "Office, equipment, finance admin and everything that keeps the lights on.",
    "declan",
    ["amara", "marcus"],
  );
  const ol = await lists(ops.id, ["This week", "Recurring", "Later"]);
  await task(ops.id, ol["This week"], {
    title: "Order laptops for the two new starters",
    by: "declan",
    tags: ["Equipment"],
    to: "marcus",
    start: 0,
    due: 2,
    subtasks: [
      ["Confirm specs with the hiring managers", true, "marcus"],
      ["Get three quotes", false, "marcus"],
      ["Approve the purchase order", false, "declan"],
    ],
  });
  await task(ops.id, ol["This week"], {
    title: "Renew office contents insurance",
    by: "declan",
    to: "amara",
    due: 4,
    urgent: true,
    comments: [["declan", "The renewal quote went up 12%. Worth getting one comparison quote before we sign.", 40]],
  });
  await task(ops.id, ol.Recurring, {
    title: "Quarterly VAT return",
    by: "declan",
    tags: ["Finance"],
    to: "declan",
    due: 18,
    repeat: { freq: "monthly", interval: 3 },
  });
  await task(ops.id, ol.Recurring, {
    title: "Monthly payroll check",
    by: "declan",
    tags: ["Finance"],
    to: "marcus",
    due: 9,
    repeat: { freq: "monthly", interval: 1 },
  });
  await task(ops.id, ol.Recurring, {
    title: "Pay supplier invoices",
    by: "declan",
    tags: ["Finance"],
    to: ["marcus", "declan"],
    due: 2,
    repeat: { freq: "weekly", interval: 1 },
    subtasks: [
      ["Match invoices to purchase orders", false, "marcus"],
      ["Approve payment run", false, "declan"],
    ],
  });
  await task(ops.id, ol.Later, { title: "Replace the meeting room screen", by: "marcus" });
  await task(ops.id, ol.Later, {
    title: "Move to a new phone provider",
    by: "declan",
    status: "on_hold",
    description: "Waiting until the current contract ends in March.",
  });

  /* Client onboarding ---------------------------------------------------------- */
  const client = await workspace(
    "Harbour & Finch onboarding",
    "orange",
    "Kick-off to handover for Harbour & Finch.",
    "sofia",
    ["amara", "tomasz", "marcus"],
  );
  const cl = await lists(client.id, ["Kick-off", "Setup", "Handover"]);
  await task(client.id, cl["Kick-off"], {
    title: "Schedule the kick-off call",
    by: "sofia",
    to: "sofia",
    status: "resolved",
  });
  const brandAssets = await task(client.id, cl["Kick-off"], {
    title: "Collect brand assets and logins",
    by: "sofia",
    to: "amara",
    start: -2,
    due: 1,
    subtasks: [
      ["Logo files (SVG + PNG)", true],
      ["Brand fonts licence", false],
      ["Analytics access", false, "tomasz"],
    ],
    comments: [
      ["marcus", "Their marketing lead is out until Thursday, so the logins may slip a couple of days.", 10],
    ],
  });
  const dashboard = await task(client.id, cl.Setup, {
    title: "Create shared reporting dashboard",
    by: "sofia",
    to: "tomasz",
    start: 3,
    due: 8,
  });
  const handover = await task(client.id, cl.Handover, {
    title: "Write the handover document",
    by: "sofia",
    start: 15,
    due: 21,
  });

  // "Waiting for" links, which show as arrows on the Gantt chart.
  await db.insert(s.taskDependencies).values([
    { taskId: cookieBanner.id, dependsOnId: speedAudit.id, createdById: ids.amara },
    { taskId: dashboard.id, dependsOnId: brandAssets.id, createdById: ids.sofia },
    { taskId: handover.id, dependsOnId: dashboard.id, createdById: ids.sofia },
  ]);

  await db.insert(s.notifications).values({
    userId: ids.amara,
    actorId: ids.sofia,
    kind: "added_to_workspace",
    workspaceId: client.id,
    createdAt: ago(24 * 5),
    readAt: ago(24 * 4),
  });

  console.log("Seeded demo data. Sign in as amara@digibooth.test (admin) or any other demo user.");
  console.log("Password for every demo account is in src/db/seed.ts (DEMO_PASSWORD).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
