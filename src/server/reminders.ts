import "server-only";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskAssignees, tasks, user, workspaces } from "@/db/schema";
import { todayIn } from "@/lib/dates";
import { appUrl, emailEnabled, renderEmail, sendEmail } from "@/lib/email";
import { PRODUCT_NAME } from "@/lib/product";

const CLOSED = ["resolved", "rejected"] as const;

/** Local hour (0 to 23) at which the reminder goes out. */
const SEND_HOUR = Number(process.env.REMINDER_HOUR) || 8;

function timeZone() {
  return process.env.DEFAULT_TIMEZONE || "UTC";
}

function localHour(tz: string) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
}

/** Most tasks listed per section, so a long backlog stays a readable email. */
export const REMINDER_SECTION_MAX = 15;

/** "Due today (3):" and one line per task, capped, with how many more are in My tasks. */
export function reminderSection(
  title: string,
  rows: { number: number; title: string; workspace: string }[],
  max = REMINDER_SECTION_MAX,
) {
  if (rows.length === 0) return "";
  const lines = rows.slice(0, max).map((r) => `#${r.number} ${r.title} (${r.workspace})`);
  if (rows.length > max) lines.push(`...and ${rows.length - max} more in My tasks`);
  return `${title} (${rows.length}):\n${lines.join("\n")}`;
}

/**
 * The morning reminder: one email per person listing their tasks that are overdue or
 * due today, sent once a day after SEND_HOUR in the team's time zone. Safe to call as
 * often as you like; it only sends to people who haven't had today's yet.
 */
export async function sendDailyReminders(opts: { force?: boolean } = {}): Promise<{ sent: number }> {
  // REMINDER_DRY_RUN composes the emails and logs them without SMTP (for checking a deploy).
  const dryRun = process.env.REMINDER_DRY_RUN === "true";
  if (!emailEnabled() && !dryRun) return { sent: 0 };
  const tz = timeZone();
  if (!opts.force && localHour(tz) < SEND_HOUR) return { sent: 0 };
  const today = todayIn(tz);

  const people = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      and(
        eq(user.dailyReminder, true),
        sql`${user.emailNotifications} <> 'none'`,
        or(isNull(user.banned), eq(user.banned, false)),
        or(isNull(user.dailyReminderSentOn), lt(user.dailyReminderSentOn, today)),
      ),
    );
  if (people.length === 0) return { sent: 0 };

  // One row per (assignee, task): a task with two assignees is in both people's emails.
  const rows = await db
    .select({
      assigneeId: taskAssignees.userId,
      number: tasks.number,
      title: tasks.title,
      dueDate: tasks.dueDate,
      workspace: workspaces.name,
    })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(
      and(
        inArray(taskAssignees.userId, people.map((p) => p.id)),
        notInArray(tasks.status, [...CLOSED]),
        sql`${tasks.dueDate} <= ${today}`,
        isNull(workspaces.archivedAt),
        eq(workspaces.isTemplate, false),
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.number));

  let sent = 0;
  for (const person of people) {
    const mine = rows.filter((r) => r.assigneeId === person.id);
    // Mark as handled even when there's nothing to send, so we don't re-check all day.
    await db.update(user).set({ dailyReminderSentOn: today }).where(eq(user.id, person.id));
    if (mine.length === 0) continue;

    const overdue = mine.filter((r) => r.dueDate! < today);
    const dueToday = mine.filter((r) => r.dueDate === today);
    // Today first (what to do now), then the most recently missed: the oldest are often stale.
    const parts = [
      reminderSection("Due today", dueToday),
      reminderSection("Overdue", [...overdue].reverse()),
    ].filter(Boolean);
    const first = person.name.split(" ")[0];
    const subject =
      overdue.length && dueToday.length
        ? `${overdue.length} overdue, ${dueToday.length} due today`
        : overdue.length
          ? `${overdue.length} overdue ${overdue.length === 1 ? "task" : "tasks"}`
          : `${dueToday.length} ${dueToday.length === 1 ? "task" : "tasks"} due today`;
    const { html, text } = renderEmail({
      heading: `Good morning ${first}: ${subject}`,
      quote: parts.join("\n\n"),
      cta: { label: "Open my tasks", url: appUrl("/my-tasks") },
      footer: "You get this once a day when something is overdue or due. Turn it off in your profile.",
    });
    if (dryRun) {
      console.log(`[reminders] would send to ${person.email}: ${subject}\n${text}`);
      sent++;
    } else if (await sendEmail({ to: person.email, subject: `${PRODUCT_NAME}: ${subject}`, text, html })) sent++;
  }
  return { sent };
}
