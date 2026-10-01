import { describe, expect, it } from "vitest";
import { computeInsights, joinNames, titleSimilarity, type InsightTask } from "@/lib/insights";

const today = "2026-09-30";
const base: InsightTask = {
  number: 1,
  title: "Task",
  status: "open",
  dueDate: null,
  assigneeNames: ["Priya Raman"],
  subtaskTotal: 0,
  subtaskDone: 0,
  lastActivity: today,
  onHoldSince: null,
};

describe("computeInsights", () => {
  it("flags overdue work, worst first", () => {
    const out = computeInsights(
      [
        { ...base, number: 1, dueDate: "2026-09-28" },
        { ...base, number: 2, dueDate: "2026-09-15" },
      ],
      today,
    );
    expect(out.map((i) => [i.kind, i.taskNumber, i.severity])).toEqual([
      ["overdue", 2, "high"],
      ["overdue", 1, "medium"],
    ]);
  });

  it("flags work due soon that hasn't started, and unowned work", () => {
    const out = computeInsights(
      [
        { ...base, number: 3, dueDate: "2026-10-01" },
        { ...base, number: 4, dueDate: "2026-10-01", status: "in_progress" },
        { ...base, number: 5, dueDate: "2026-10-04", assigneeNames: [], status: "in_progress" },
      ],
      today,
    );
    expect(out.find((i) => i.taskNumber === 3)?.kind).toBe("due_soon_not_started");
    expect(out.some((i) => i.taskNumber === 4)).toBe(false);
    expect(out.find((i) => i.taskNumber === 5)?.kind).toBe("unassigned_due_soon");
  });

  it("flags quiet and long-on-hold tasks but ignores closed ones", () => {
    const out = computeInsights(
      [
        { ...base, number: 6, lastActivity: "2026-09-01" },
        { ...base, number: 7, status: "on_hold", onHoldSince: "2026-09-10", lastActivity: "2026-09-10" },
        { ...base, number: 8, status: "resolved", dueDate: "2026-09-01" },
      ],
      today,
    );
    expect(out.find((i) => i.taskNumber === 6)?.kind).toBe("stale");
    expect(out.find((i) => i.taskNumber === 7)?.kind).toBe("long_on_hold");
    expect(out.some((i) => i.taskNumber === 8)).toBe(false);
  });

  it("flags people with a pile-up due this week", () => {
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      ...base,
      number: 20 + i,
      status: "in_progress" as const,
      dueDate: "2026-10-03",
      assigneeNames: ["Tomasz Wiśniewski"],
    }));
    const out = computeInsights(tasks, today);
    expect(out.find((i) => i.kind === "overloaded")?.person).toBe("Tomasz Wiśniewski");
  });

  it("counts a shared task for each of its assignees", () => {
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      ...base,
      number: 30 + i,
      status: "in_progress" as const,
      dueDate: "2026-10-03",
      assigneeNames: i < 2 ? ["Sofia Lindqvist", "Marcus Ellery"] : ["Sofia Lindqvist"],
    }));
    const out = computeInsights(tasks, today).filter((i) => i.kind === "overloaded");
    // Sofia is on all four (due this week); Marcus only on two.
    expect(out.map((i) => i.person)).toEqual(["Sofia Lindqvist"]);
  });

  it("names every assignee on a task's warning, and only flags tasks with nobody", () => {
    const out = computeInsights(
      [
        { ...base, number: 40, dueDate: "2026-09-20", assigneeNames: ["Priya Raman", "Sam Ortiz"] },
        { ...base, number: 41, dueDate: "2026-10-02", status: "in_progress", assigneeNames: ["Sam Ortiz", "Lee Park"] },
      ],
      today,
    );
    expect(out.find((i) => i.taskNumber === 40)?.person).toBe("Priya Raman and Sam Ortiz");
    expect(out.some((i) => i.kind === "unassigned_due_soon")).toBe(false);
  });
});

describe("joinNames", () => {
  it("lists people in plain English", () => {
    expect(joinNames([])).toBeUndefined();
    expect(joinNames(["Priya"])).toBe("Priya");
    expect(joinNames(["Priya", "Sam"])).toBe("Priya and Sam");
    expect(joinNames(["Priya", "Sam", "Lee"])).toBe("Priya, Sam and Lee");
  });
});

describe("titleSimilarity", () => {
  it("scores near-duplicates high and unrelated titles low", () => {
    expect(
      titleSimilarity("Set up 301 redirects for old URLs", "Set up redirects for the old URLs"),
    ).toBeGreaterThan(0.6);
    expect(titleSimilarity("Order laptops", "Write the handover document")).toBe(0);
  });
});

describe("blocked tasks", () => {
  it("warns when a task due soon is still waiting on an open blocker", async () => {
    const { computeInsights } = await import("../insights");
    const base = {
      status: "open" as const,
      assigneeNames: ["Sam"],
      subtaskTotal: 0,
      subtaskDone: 0,
      lastActivity: "2026-10-01",
      onHoldSince: null,
    };
    const out = computeInsights(
      [
        { ...base, number: 1, title: "Launch", dueDate: "2026-10-03", blockers: [{ number: 2, title: "QA", dueDate: "2026-10-05" }] },
        { ...base, number: 3, title: "Fine", dueDate: "2026-10-03", blockers: [] },
      ],
      "2026-10-01",
    );
    const blocked = out.filter((i) => i.kind === "blocked_due_soon");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].taskNumber).toBe(1);
    expect(blocked[0].severity).toBe("high");
    expect(blocked[0].detail).toContain("#2");
  });
});
