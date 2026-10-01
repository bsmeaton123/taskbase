"use server";

import { z } from "zod";
import type { TaskStatus } from "@/db/schema";
import { requireActionUser } from "@/lib/session";
import { run } from "@/server/action-utils";
import { searchTasks } from "@/server/queries";

export type FoundTask = {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  workspace: { id: string; name: string; color: string };
};

/**
 * Tasks for the Cmd+K palette: the task with that number first, then titles that start
 * with the query, then other title matches, then matches in descriptions, comments and
 * subtasks. Uses searchTasks, so it's scoped to the viewer's workspaces like search.
 */
export async function quickFind(query: string) {
  return run(
    async (): Promise<FoundTask[]> => {
      const viewer = await requireActionUser();
      const q = z.string().max(200).parse(query).trim();
      if (!q) return [];
      const rows = await searchTasks(viewer, q);
      const lower = q.toLowerCase();
      const number = /^#?(\d{1,9})$/.exec(q)?.[1];
      const rank = (t: (typeof rows)[number]) => {
        const title = t.title.toLowerCase();
        if (number && t.number === Number(number)) return 0;
        if (title.startsWith(lower)) return 1;
        if (title.includes(lower)) return 2;
        return 3;
      };
      return rows
        .map((t, i) => ({ t, r: rank(t), i }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .slice(0, 8)
        .map(({ t }) => ({
          id: t.id,
          number: t.number,
          title: t.title,
          status: t.status,
          workspace: t.workspace,
        }));
    },
    { refresh: false },
  );
}
