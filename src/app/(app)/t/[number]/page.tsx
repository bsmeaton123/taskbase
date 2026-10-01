import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { tasks, trashedTasks } from "@/db/schema";
import { getWorkspaceAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";

/** Short, shareable task links: /t/142 → the task inside its workspace. */
export default async function TaskLink({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) notFound();
  const viewer = await requireUser();
  const [task] = await db
    .select({ id: tasks.id, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.number, n))
    .limit(1);
  if (!task) {
    // A deleted task: show it in its workspace's trash, where it can be restored.
    const [trashed] = await db
      .select({ workspaceId: trashedTasks.workspaceId })
      .from(trashedTasks)
      .where(eq(trashedTasks.number, n))
      .limit(1);
    if (trashed && (await getWorkspaceAccess(viewer, trashed.workspaceId)))
      redirect(`/w/${trashed.workspaceId}/trash?task=${n}`);
  }
  // Same response for "doesn't exist" and "no access", so links don't leak.
  if (!task || !(await getWorkspaceAccess(viewer, task.workspaceId))) notFound();
  redirect(`/w/${task.workspaceId}?task=${task.id}`);
}
