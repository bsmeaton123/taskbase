import { describe, expect, it } from "vitest";
import { columnFor, mondayOf, planMove, weekColumns, weekFromParam } from "../workload";

// 2026-10-01 is a Thursday.
const today = "2026-10-01";

describe("weeks", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28"); // Sunday
  });

  it("reads ?week=, never earlier than this week or more than a year ahead", () => {
    expect(weekFromParam(undefined, today)).toBe("2026-09-28");
    expect(weekFromParam("nonsense", today)).toBe("2026-09-28");
    expect(weekFromParam("2026-10-08", today)).toBe("2026-10-05");
    expect(weekFromParam("2026-09-01", today)).toBe("2026-09-28");
    expect(weekFromParam("2030-01-01", today)).toBe("2027-09-27");
  });
});

describe("weekColumns", () => {
  const cols = weekColumns("2026-09-28", today);

  it("lays out Overdue, the days still to come, the weekend and No date", () => {
    expect(cols.map((c) => c.key)).toEqual(["overdue", "thu", "fri", "weekend", "none"]);
    expect(cols.find((c) => c.key === "thu")).toMatchObject({ today: true, past: false, dropDate: "2026-10-01" });
    expect(weekColumns("2026-10-05", today).map((c) => c.key)).toEqual([
      "overdue", "mon", "tue", "wed", "thu", "fri", "weekend", "none",
    ]);
    expect(cols.find((c) => c.key === "weekend")).toMatchObject({ dropDate: "2026-10-03", dates: ["2026-10-03", "2026-10-04"] });
    expect(cols.find((c) => c.key === "none")?.dropDate).toBeNull();
  });

  it("drops on Sunday when Saturday has gone", () => {
    const sunday = weekColumns("2026-09-28", "2026-10-04").find((c) => c.key === "weekend");
    expect(sunday).toMatchObject({ dropDate: "2026-10-04", today: true, past: false });
  });

  it("places tasks by due date", () => {
    expect(columnFor(null, cols, today)).toBe("none");
    expect(columnFor("2026-09-29", cols, today)).toBe("overdue"); // earlier this week
    expect(columnFor("2026-10-01", cols, today)).toBe("thu");
    expect(columnFor("2026-10-04", cols, today)).toBe("weekend");
    expect(columnFor("2026-10-09", cols, today)).toBeNull(); // next week
  });
});

describe("planMove", () => {
  const task = { assigneeIds: ["priya", "sofia"], startDate: "2026-09-29", dueDate: "2026-10-01" };

  it("hands the task from one person to another, keeping anyone else on it", () => {
    const plan = planMove(task, { from: "priya", to: "tomasz", dueDate: task.dueDate });
    expect(plan).toMatchObject({ remove: "priya", add: "tomasz", changed: true });
    expect(plan.assigneeIds).toEqual(["sofia", "tomasz"]);
  });

  it("only takes the person off when the new one is already assigned", () => {
    const plan = planMove(task, { from: "priya", to: "sofia", dueDate: task.dueDate });
    expect(plan).toMatchObject({ remove: "priya", add: null });
    expect(plan.assigneeIds).toEqual(["sofia"]);
  });

  it("assigns from the Unassigned row and unassigns onto it", () => {
    const open = { assigneeIds: [], startDate: null, dueDate: null };
    expect(planMove(open, { from: null, to: "amara", dueDate: null }).assigneeIds).toEqual(["amara"]);
    expect(planMove(task, { from: "priya", to: null, dueDate: task.dueDate }).assigneeIds).toEqual(["sofia"]);
  });

  it("moves the start date with the due date", () => {
    const plan = planMove(task, { from: "priya", to: "priya", dueDate: "2026-10-05" });
    expect(plan).toMatchObject({ startDate: "2026-10-03", dueDate: "2026-10-05", add: null, remove: null, changed: true });
  });

  it("pulls a start date back when an undated task lands before it", () => {
    const undated = { assigneeIds: ["priya"], startDate: "2026-10-06", dueDate: null };
    expect(planMove(undated, { from: "priya", to: "priya", dueDate: "2026-10-02" }).startDate).toBe("2026-10-02");
  });

  it("keeps the start date when the due date is removed, and spots no-op drops", () => {
    expect(planMove(task, { from: "priya", to: "priya", dueDate: null })).toMatchObject({ startDate: "2026-09-29", dueDate: null });
    expect(planMove(task, { from: "priya", to: "priya", dueDate: task.dueDate }).changed).toBe(false);
  });
});
