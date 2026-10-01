import { describe, expect, it } from "vitest";
import { matchPeople, planProject } from "../redbooth-plan";

const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const now = new Date("2026-10-01T09:00:00Z");

const rbUsers = [
  { id: "1", first_name: "Amara", last_name: "Okafor", email: "amara@x.test" },
  { id: "2", first_name: "Priya", last_name: "Raman", email: "PRIYA@x.test" },
  { id: "3", first_name: "Old", last_name: "Hand", email: "old@x.test" },
  { id: "4", first_name: "Nadia", last_name: "Brooks", email: "nadia@other.test" },
];
const localPeople = [
  { id: "u-amara", email: "amara@x.test", active: true },
  { id: "u-priya", email: "priya@x.test", active: true },
  { id: "u-old", email: "old@x.test", active: false },
];
const users = matchPeople(rbUsers, localPeople);

function plan(over: Partial<Parameters<typeof planProject>[0]> = {}) {
  return planProject({
    project: { id: "p1", name: "  Client work -  Web Design & Dev " },
    lists: [
      { id: "l-done", name: "Done", position: 1, archived: true },
      { id: "l-live", name: "Live", position: 2 },
      { id: "l-gone", name: "Gone", position: 3, deleted: true },
    ],
    tasks: [
      { id: "t1", name: "First", task_list_id: "l-live", position: 2, status: "open", assigned_id: "2", user_id: "1", watcher_ids: ["1", "3", "4"], due_on: "2026-10-02", created_at: t("2026-09-28T15:00:00Z") },
      { id: "t2", name: "Second", task_list_id: "l-live", position: 1, status: "hold", assigned_id: "4", user_id: "4", urgent: true, description_html: "<p>From <b>HTML</b></p>" },
      { id: "t3", name: "Done one", task_list_id: "l-done", status: "resolved", assigned_id: "3", updated_at: t("2026-09-29T10:00:00Z"), created_at: t("2026-09-20T10:00:00Z") },
      { id: "t4", name: "Deleted", task_list_id: "l-live", deleted: true },
      { id: "t5", name: "Orphan", task_list_id: "l-gone" },
    ],
    subtasks: [
      { id: "s2", task_id: "t1", name: "Second step", position: 2 },
      { id: "s1", task_id: "t1", name: "First step", position: 1, resolved: true, created_at: t("2026-09-28T16:00:00Z") },
      { id: "s9", task_id: "t4", name: "On a deleted task" },
    ],
    comments: [
      { id: "c2", target_id: "t1", user_id: "4", body: "Asked the client for examples", upload_ids: ["f1", "f-missing"], created_at: t("2026-09-30T15:06:00Z") },
      { id: "c1", target_id: "t1", user_id: "1", body: "Thanks", created_at: t("2026-09-30T15:00:00Z") },
      { id: "c3", target_id: "t1", user_id: "2", body: "", body_html: "" },
      { id: "c4", target_id: "t2", user_id: "2", body: "", upload_ids: ["f1"] },
      { id: "c5", target_id: "t4", user_id: "1", body: "On a deleted task" },
    ],
    people: [
      { user_id: "1", role: "admin" },
      { user_id: "2", role: "participant" },
      { user_id: "3", role: "admin" },
      { user_id: "4", role: "admin" },
    ],
    files: [{ id: "f1", name: "spam.txt", size: 64 }],
    users,
    importerId: "u-amara",
    color: "teal",
    dateLabel: "1 Oct 2026",
    now,
    ...over,
  });
}

describe("matchPeople", () => {
  it("matches by email regardless of case, and keeps names for everyone", () => {
    expect(users.get("2")?.local).toEqual({ id: "u-priya", active: true });
    expect(users.get("3")?.local).toEqual({ id: "u-old", active: false });
    expect(users.get("4")).toEqual({ name: "Nadia Brooks", email: "nadia@other.test", local: null });
  });
});

describe("planProject", () => {
  const p = plan();

  it("names the workspace and says where it came from", () => {
    expect(p.workspace).toEqual({ name: "Client work - Web Design & Dev", description: "Imported from Redbooth on 1 Oct 2026.", color: "teal" });
  });

  it("adds the importer as owner and matched, active people as members", () => {
    expect(p.members).toEqual([
      { userId: "u-amara", role: "owner" },
      { userId: "u-priya", role: "member" },
    ]);
    expect(p.unmatched).toEqual([{ name: "Nadia Brooks", email: "nadia@other.test" }]);
  });

  it("puts live lists before archived ones, drops deleted lists, and catches orphaned tasks", () => {
    expect(p.lists.map((l) => [l.key, l.name, l.position])).toEqual([
      ["l-live", "Live", 1],
      ["l-done", "Done", 2],
      ["default", "Tasks", 3],
    ]);
    expect(p.tasks.find((x) => x.key === "t5")?.listKey).toBe("default");
  });

  it("skips deleted tasks and keeps Redbooth's order within a list", () => {
    expect(p.tasks.map((x) => x.key)).not.toContain("t4");
    expect(p.skipped.deletedTasks).toBe(1);
    const live = p.tasks.filter((x) => x.listKey === "l-live").map((x) => [x.key, x.position]);
    expect(live).toEqual([["t2", 1], ["t1", 2]]);
  });

  it("maps fields, keeping only members as assignees and followers", () => {
    const t1 = p.tasks.find((x) => x.key === "t1")!;
    expect(t1).toMatchObject({ title: "First", status: "open", dueDate: "2026-10-02", createdById: "u-amara", assigneeIds: ["u-priya"] });
    expect(t1.createdAt.toISOString()).toBe("2026-09-28T15:00:00.000Z");
    expect(t1.followerIds.sort()).toEqual(["u-amara", "u-priya"]);

    const t2 = p.tasks.find((x) => x.key === "t2")!;
    expect(t2).toMatchObject({ status: "on_hold", urgent: true, description: "From HTML", assigneeIds: [], createdById: "u-amara" });

    // Assigned to a deactivated person: left unassigned.
    const t3 = p.tasks.find((x) => x.key === "t3")!;
    expect(t3.assigneeIds).toEqual([]);
    expect(t3.completedAt?.toISOString()).toBe("2026-09-29T10:00:00.000Z");
  });

  it("orders subtasks and drops ones on deleted tasks", () => {
    expect(p.subtasks.map((s) => [s.title, s.done, s.position])).toEqual([
      ["First step", true, 1],
      ["Second step", false, 2],
    ]);
  });

  it("keeps comments in time order, credits unmatched authors in the text, skips empty ones", () => {
    expect(p.comments.map((c) => [c.key, c.authorId, c.body])).toEqual([
      ["c1", "u-amara", "Thanks"],
      ["c2", null, "Nadia Brooks wrote in Redbooth:\nAsked the client for examples"],
      ["c4", "u-priya", ""],
    ]);
    expect(p.skipped.emptyComments).toBe(1);
  });

  it("lists the files attached through comments, ignoring ones Redbooth doesn't have", () => {
    expect(p.files.map((f) => [f.file.id, f.commentKey, f.taskKey, f.uploaderId])).toEqual([
      ["f1", "c2", "t1", null],
      ["f1", "c4", "t2", "u-priya"],
    ]);
  });

  it("copes with an empty project", () => {
    const empty = plan({ lists: [], tasks: [], subtasks: [], comments: [], people: [], files: [] });
    expect(empty.lists).toEqual([{ key: "default", name: "Tasks", position: 1 }]);
    expect(empty.members).toEqual([{ userId: "u-amara", role: "owner" }]);
  });
});
