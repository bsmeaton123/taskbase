import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { describeActivity, type ActivityContext } from "@/components/activity-text";
import type { ActivityData, ActivityKind } from "@/db/schema";

const ctx: ActivityContext = { today: "2026-10-01", viewerId: "me", actorId: "priya" };

/** The wording as plain text, plus whether it contains a link. */
function words(kind: ActivityKind, data: ActivityData, extra: Partial<ActivityContext> = {}) {
  const { text } = describeActivity(kind, data, { ...ctx, ...extra });
  const html = renderToStaticMarkup(createElement(Fragment, null, text));
  return { text: html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"'), linked: html.includes("<a ") };
}

describe("describeActivity", () => {
  it("keeps the task history wording", () => {
    expect(words("status_changed", { from: "open", to: "resolved" }).text).toBe(
      "changed the status to Resolved",
    );
    expect(words("due_changed", { from: "2026-09-29", to: "2026-10-01" }).text).toBe(
      "set the due date to Today",
    );
    expect(words("due_changed", { from: "2026-09-29", to: null }).text).toBe("removed the due date");
    expect(words("renamed", { from: "Draft", to: "Final" }).text).toBe("renamed this from “Draft”");
    expect(words("moved", { list: "Review", workspace: "Website" }).text).toBe(
      "moved this to Review in Website",
    );
    expect(words("tag_added", { name: "Design" }).text).toBe("tagged this Design");
    expect(words("restored", {}).text).toBe("restored this from the trash");
  });

  it("words assignments from the viewer's side, with or without a name", () => {
    expect(words("assigned", { userId: "me", name: "Me" }).text).toBe("assigned this to you");
    expect(words("assigned", { userId: "sofia", name: "Sofia" }).text).toBe("assigned this to Sofia");
    expect(words("assigned", { userId: "sofia" }).text).toBe("assigned this to someone");
    expect(words("assigned", { userId: "priya", name: "Priya" }).text).toBe("joined this task");
    expect(words("unassigned", {}).text).toBe("removed the assignee");
    expect(words("task_created", {}).text).toBe("created this task");
    expect(words("task_created", { source: "Redbooth" }).text).toBe("created this task in Redbooth");
    expect(words("task_created", { via: "email" }).text).toBe("created this task by email");
    expect(words("unassigned", { userId: "sofia", name: "Sofia" }).text).toBe("unassigned Sofia");
    expect(words("unassigned", { userId: "me", name: "Me" }).text).toBe("unassigned you");
    expect(words("unassigned", { userId: "priya", name: "Priya" }).text).toBe("left this task");
    expect(words("unassigned", { name: "Sofia" }).text).toBe("unassigned Sofia");
  });

  it("links task numbers in the task panel but not inside an Updates card", () => {
    const data = { number: 12, title: "Copy" };
    expect(words("blocker_added", data)).toEqual({
      text: "marked this as waiting for #12 “Copy”",
      linked: true,
    });
    expect(words("blocker_added", data, { linkTasks: false }).linked).toBe(false);
  });
});
