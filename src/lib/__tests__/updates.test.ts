import { describe, expect, it } from "vitest";
import type { ActivityData, ActivityKind } from "@/db/schema";
import {
  changePair,
  formatUpdateTime,
  GROUP_GAP_MS,
  groupUpdates,
  summariseGroup,
  updatesCountLabel,
  type UpdateItem,
} from "@/lib/updates";

const base = new Date("2026-09-30T14:00:00Z").getTime();
const at = (minutes: number) => new Date(base + minutes * 60_000);

let n = 0;
function activity(
  minutes: number,
  kind: ActivityKind,
  data: ActivityData = {},
  { task = "t1", actor = "priya" }: { task?: string; actor?: string | null } = {},
): UpdateItem {
  return { type: "activity", id: `a${++n}`, taskId: task, actorId: actor, createdAt: at(minutes), kind, data };
}
function comment(
  minutes: number,
  excerpt: string,
  { task = "t1", actor = "priya" }: { task?: string; actor?: string | null } = {},
): UpdateItem {
  return { type: "comment", id: `c${++n}`, taskId: task, actorId: actor, createdAt: at(minutes), excerpt, fileCount: 0 };
}

describe("groupUpdates", () => {
  it("puts one person's changes to one task within ten minutes on one card", () => {
    const items = [
      activity(0, "due_changed", { from: "2026-09-29", to: "2026-09-30" }),
      activity(4, "status_changed", { from: "open", to: "in_progress" }),
      comment(12, "Started on this"),
    ];
    const groups = groupUpdates(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(groups[0].at).toEqual(at(12));
  });

  it("chains on the gap between changes, not the time since the first", () => {
    const items = [activity(0, "renamed"), activity(9, "renamed"), activity(18, "renamed")];
    expect(groupUpdates(items)).toHaveLength(1);
  });

  it("starts a new card after a longer gap", () => {
    const groups = groupUpdates([
      activity(0, "tag_added", { name: "Design" }),
      activity(GROUP_GAP_MS / 60_000 + 1, "tag_added", { name: "Copy" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps different people and different tasks apart", () => {
    const groups = groupUpdates([
      activity(0, "file_added", { name: "a.pdf" }),
      activity(1, "file_added", { name: "b.pdf" }, { actor: "tomasz" }),
      activity(2, "file_added", { name: "c.pdf" }, { task: "t2" }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("breaks a run when someone else updates the same task in between", () => {
    const groups = groupUpdates([
      activity(0, "status_changed", { from: "open", to: "on_hold" }),
      comment(1, "Why on hold?", { actor: "tomasz" }),
      activity(2, "status_changed", { from: "on_hold", to: "open" }),
    ]);
    expect(groups.map((g) => g.actorId)).toEqual(["priya", "tomasz", "priya"]);
  });

  it("doesn't let another task's update break a run", () => {
    const groups = groupUpdates([
      activity(0, "urgent_changed", { urgent: true }),
      comment(1, "Unrelated", { task: "t2", actor: "tomasz" }),
      activity(2, "subtask_added", { title: "Check copy" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.taskId === "t1")!.items).toHaveLength(2);
  });

  it("returns cards newest first whatever order the items arrive in", () => {
    const groups = groupUpdates([
      activity(0, "renamed", {}, { task: "old" }),
      activity(60, "renamed", {}, { task: "new" }),
      activity(30, "renamed", {}, { task: "middle" }),
    ]);
    expect(groups.map((g) => g.taskId)).toEqual(["new", "middle", "old"]);
  });

  it("groups changes by a former member (no actor) together", () => {
    const groups = groupUpdates([activity(0, "renamed", {}, { actor: null }), comment(1, "x", { actor: null })]);
    expect(groups).toHaveLength(1);
  });
});

describe("summariseGroup", () => {
  it("says commented when a card is only comments", () => {
    expect(summariseGroup([comment(0, "Hello"), comment(1, "Again")]).verb).toBe("commented");
  });

  it("says updated for changes, with or without a comment", () => {
    const { verb, lines } = summariseGroup([
      activity(0, "status_changed", { from: "open", to: "resolved" }),
      comment(1, "Done"),
    ]);
    expect(verb).toBe("updated");
    expect(lines.map((l) => l.type)).toEqual(["activity", "comment"]);
  });

  it("says created, and leaves the creation itself out of the lines", () => {
    const { verb, lines } = summariseGroup([
      activity(0, "task_created"),
      activity(0, "assigned", { userId: "amara", name: "Amara Okafor" }),
    ]);
    expect(verb).toBe("created");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "assigned" });
  });

  it("says restored for a task brought back from the trash", () => {
    const { verb, lines } = summariseGroup([activity(0, "restored")]);
    expect(verb).toBe("restored");
    expect(lines).toEqual([]);
  });

  it("merges repeated changes to one field into first before, last after", () => {
    const { lines } = summariseGroup([
      activity(0, "due_changed", { from: "2026-09-29", to: "2026-10-02" }),
      activity(1, "status_changed", { from: "open", to: "in_progress" }),
      activity(2, "due_changed", { from: "2026-10-02", to: "2026-10-05" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "due_changed", data: { from: "2026-09-29", to: "2026-10-05" } });
    expect(lines[1]).toMatchObject({ kind: "status_changed" });
  });

  it("drops a field that was changed and changed back", () => {
    const { lines } = summariseGroup([
      activity(0, "status_changed", { from: "open", to: "on_hold" }),
      activity(1, "status_changed", { from: "on_hold", to: "open" }),
      activity(2, "tag_added", { name: "Design" }),
    ]);
    expect(lines.map((l) => (l.type === "activity" ? l.kind : l.type))).toEqual(["tag_added"]);
  });

  it("keeps a removed date as a change", () => {
    const { lines } = summariseGroup([activity(0, "due_changed", { from: "2026-09-29", to: null })]);
    expect(lines).toHaveLength(1);
  });

  it("doesn't merge kinds that only record the new value", () => {
    const { lines } = summariseGroup([
      activity(0, "tag_added", { name: "Design" }),
      activity(1, "tag_added", { name: "Copy" }),
    ]);
    expect(lines).toHaveLength(2);
  });
});

describe("changePair", () => {
  const today = "2026-10-01";

  it("shows due and start dates before and after, relative to today", () => {
    expect(changePair("due_changed", { from: "2026-09-29", to: "2026-10-01" }, today)).toEqual({
      label: "Due date",
      from: "29 Sep",
      to: "Today",
    });
    expect(changePair("start_changed", { from: null, to: "2026-10-02" }, today)).toEqual({
      label: "Start date",
      from: "No date",
      to: "Tomorrow",
    });
    expect(changePair("due_changed", { from: "2026-09-30", to: null }, today)?.to).toBe("No date");
  });

  it("uses status labels", () => {
    expect(changePair("status_changed", { from: "in_progress", to: "resolved" }, today)).toEqual({
      label: "Status",
      from: "In progress",
      to: "Resolved",
    });
  });

  it("quotes titles", () => {
    expect(changePair("renamed", { from: "Draft", to: "Final" }, today)).toEqual({
      label: "Title",
      from: "“Draft”",
      to: "“Final”",
    });
  });

  it("is null when only the new value was recorded, or for other kinds", () => {
    expect(changePair("status_changed", { to: "resolved" }, today)).toBeNull();
    expect(changePair("assigned", { userId: "x", name: "Priya" }, today)).toBeNull();
    expect(changePair("unassigned", {}, today)).toBeNull();
  });
});

describe("formatUpdateTime", () => {
  // Thursday 1 October 2026, 5:30 pm in London (BST, UTC+1).
  const now = new Date("2026-10-01T16:30:00Z");
  const tz = "Europe/London";

  it("shows just the time today", () => {
    expect(formatUpdateTime(new Date("2026-10-01T15:09:00Z"), now, tz)).toBe("4:09 pm");
    expect(formatUpdateTime(new Date("2026-10-01T00:05:00Z"), now, tz)).toBe("1:05 am");
    expect(formatUpdateTime(new Date("2026-10-01T11:00:00Z"), now, tz)).toBe("12:00 pm");
  });

  it("says yesterday, then the weekday within the week", () => {
    expect(formatUpdateTime(new Date("2026-09-30T14:06:00Z"), now, tz)).toBe("Yesterday 3:06 pm");
    expect(formatUpdateTime(new Date("2026-09-29T15:09:00Z"), now, tz)).toBe("Tue 4:09 pm");
  });

  it("uses the date further back, with the year when it differs", () => {
    expect(formatUpdateTime(new Date("2026-09-20T08:00:00Z"), now, tz)).toBe("20 Sep, 9:00 am");
    expect(formatUpdateTime(new Date("2025-12-31T23:30:00Z"), new Date("2026-01-20T12:00:00Z"), tz)).toBe(
      "31 Dec 2025, 11:30 pm",
    );
  });

  it("works out the day in the viewer's time zone", () => {
    // 11:30 pm on 30 Sep in UTC is already 1 Oct in Tokyo; noon UTC on 1 Oct is 9 pm there.
    const late = new Date("2026-09-30T23:30:00Z");
    const noon = new Date("2026-10-01T12:00:00Z");
    expect(formatUpdateTime(late, noon, "UTC")).toBe("Yesterday 11:30 pm");
    expect(formatUpdateTime(late, noon, "Asia/Tokyo")).toBe("8:30 am");
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(formatUpdateTime(new Date("2026-10-01T15:09:00Z"), now, "Not/AZone")).toBe("3:09 pm");
  });
});

describe("updatesCountLabel", () => {
  it("caps the tab count", () => {
    expect(updatesCountLabel(7)).toBe("7");
    expect(updatesCountLabel(99)).toBe("99");
    expect(updatesCountLabel(100)).toBe("99+");
  });
});
