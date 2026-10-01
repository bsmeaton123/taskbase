import "server-only";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { comments, notifications, tasks, user, workspaces } from "@/db/schema";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { decodeMentions } from "@/lib/mentions";

const IMPORTANT = new Set(["assigned", "mentioned", "added_to_workspace", "unblocked"]);

function wantsEmail(preference: string, kind: string) {
  if (preference === "none") return false;
  if (preference === "all") return true;
  return IMPORTANT.has(kind);
}

/** Emails freshly created notifications, respecting each person's preference. */
export async function deliverNotificationEmails(ids: string[]) {
  if (ids.length === 0) return;
  const recipient = alias(user, "recipient");
  const actor = alias(user, "actor");
  const rows = await db
    .select({
      kind: notifications.kind,
      data: notifications.data,
      to: recipient.email,
      preference: recipient.emailNotifications,
      banned: recipient.banned,
      actorName: actor.name,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      commentBody: comments.body,
    })
    .from(notifications)
    .innerJoin(recipient, eq(recipient.id, notifications.userId))
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .leftJoin(tasks, eq(tasks.id, notifications.taskId))
    .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
    .leftJoin(comments, eq(comments.id, notifications.commentId))
    .where(inArray(notifications.id, ids));

  await Promise.all(
    rows
      .filter((r) => !r.banned && wantsEmail(r.preference, r.kind))
      .map((r) => {
        const who = r.actorName ?? "Someone";
        const title = r.taskTitle ?? "a task";
        const taskUrl = r.taskNumber ? appUrl(`/t/${r.taskNumber}`) : appUrl("/inbox");
        const quote = r.commentBody ? decodeMentions(r.commentBody).text.slice(0, 600) : undefined;

        let subject: string;
        let heading: string;
        let cta = { label: "Open task", url: taskUrl };
        switch (r.kind) {
          case "assigned":
            subject = r.data.subtask
              ? `${who} assigned you a subtask in ${title}`
              : `${who} assigned you: ${title}`;
            heading = r.data.subtask
              ? `${who} assigned you “${r.data.subtask}” in “${title}”`
              : `${who} assigned you “${title}”`;
            break;
          case "mentioned":
            subject = `${who} mentioned you in ${title}`;
            heading = `${who} mentioned you in “${title}”`;
            break;
          case "commented":
            subject = `${who} commented on ${title}`;
            heading = `${who} commented on “${title}”`;
            break;
          case "status_changed":
            subject = `${who} marked ${title} as ${r.data.to ?? "updated"}`;
            heading = `${who} changed “${title}” to ${r.data.to ?? "a new status"}`;
            break;
          case "added_to_workspace":
            subject = `${who} added you to ${r.workspaceName ?? "a workspace"}`;
            heading = `${who} added you to the ${r.workspaceName ?? ""} workspace`;
            cta = {
              label: "Open workspace",
              url: r.workspaceId ? appUrl(`/w/${r.workspaceId}`) : appUrl("/"),
            };
            break;
          case "unblocked":
            subject = `Ready to start: ${title}`;
            heading = `“${title}” is ready to start`;
            break;
          default:
            return Promise.resolve(false);
        }
        const where = r.workspaceName ? `In ${r.workspaceName}` : undefined;
        const { html, text } = renderEmail({
          heading,
          body:
            r.kind === "unblocked"
              ? `${who} finished “${r.data.blockerTitle ?? "the task it was waiting for"}”, so nothing is holding it up now.${where ? ` ${where}.` : ""}`
              : r.kind !== "added_to_workspace"
                ? where
                : undefined,
          quote,
          cta,
        });
        return sendEmail({ to: r.to, subject, text, html });
      }),
  );
}

/** One email for a batch of assignments ("Amara assigned you 12 tasks"), instead of 12. */
export async function deliverBulkAssignmentEmail(input: {
  assigneeId: string;
  actorId: string;
  workspaceId: string;
  tasks: { number: number; title: string }[];
}) {
  if (input.tasks.length === 0 || input.assigneeId === input.actorId) return;
  const [recipient] = await db
    .select({ email: user.email, preference: user.emailNotifications, banned: user.banned })
    .from(user)
    .where(eq(user.id, input.assigneeId));
  if (!recipient || recipient.banned || !wantsEmail(recipient.preference, "assigned")) return;
  const [[actor], [workspace]] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, input.actorId)),
    db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, input.workspaceId)),
  ]);
  const who = actor?.name ?? "Someone";
  const n = input.tasks.length;
  if (n === 1) {
    const [t] = input.tasks;
    const { html, text } = renderEmail({
      heading: `${who} assigned you “${t.title}”`,
      body: workspace ? `In ${workspace.name}` : undefined,
      cta: { label: "Open task", url: appUrl(`/t/${t.number}`) },
    });
    await sendEmail({ to: recipient.email, subject: `${who} assigned you: ${t.title}`, text, html });
    return;
  }
  const shown = input.tasks.slice(0, 15);
  const list = shown.map((t) => `#${t.number} ${t.title}`).join("\n");
  const more = n > shown.length ? `\n…and ${n - shown.length} more` : "";
  const { html, text } = renderEmail({
    heading: `${who} assigned you ${n} tasks${workspace ? ` in ${workspace.name}` : ""}`,
    quote: list + more,
    cta: { label: "See your tasks", url: appUrl("/my-tasks") },
  });
  await sendEmail({
    to: recipient.email,
    subject: `${who} assigned you ${n} tasks${workspace ? ` in ${workspace.name}` : ""}`,
    text,
    html,
  });
}
