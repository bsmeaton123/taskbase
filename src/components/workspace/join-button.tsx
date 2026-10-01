"use client";

import { useTransition } from "react";
import { perform } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { joinWorkspace } from "@/server/actions/workspaces";

export function JoinWorkspaceButton({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await perform(joinWorkspace(workspaceId), { success: "You joined the workspace" });
        })
      }
    >
      {pending ? "Joining…" : "Join"}
    </Button>
  );
}
