import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, workspaceMembers, workspaces } from "@/db/schema";
import { ActionError, type CurrentUser } from "@/lib/session";

export type WorkspaceAccess = {
  workspace: typeof workspaces.$inferSelect;
  role: "owner" | "member" | "admin";
  /** Owners and org admins can rename, archive and manage members. */
  canManage: boolean;
};

/**
 * Returns the workspace if the user may see it: members, plus org admins
 * (who can reach any workspace for support and clean-up).
 */
export async function getWorkspaceAccess(
  user: CurrentUser,
  workspaceId: string,
): Promise<WorkspaceAccess | null> {
  const [row] = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!row) return null;
  if (!row.role && !user.isAdmin) return null;
  const role = row.role ?? "admin";
  return {
    workspace: row.workspace,
    role,
    canManage: role === "owner" || user.isAdmin,
  };
}

export async function assertWorkspaceAccess(
  user: CurrentUser,
  workspaceId: string,
  opts: { manage?: boolean } = {},
): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(user, workspaceId);
  if (!access) throw new ActionError("You don't have access to that workspace.");
  if (opts.manage && !access.canManage)
    throw new ActionError("Only workspace owners can do that.");
  return access;
}

export async function assertTaskAccess(user: CurrentUser, taskId: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) throw new ActionError("That task no longer exists.");
  const access = await assertWorkspaceAccess(user, task.workspaceId);
  return { task, access };
}
