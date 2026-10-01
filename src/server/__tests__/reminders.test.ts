import { describe, expect, it } from "vitest";
import { reminderSection } from "../reminders";

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `Task ${i + 1}`, workspace: "Ops" }));

describe("reminderSection", () => {
  it("lists every task when there are only a few", () => {
    expect(reminderSection("Due today", rows(2))).toBe(
      "Due today (2):\n#1 Task 1 (Ops)\n#2 Task 2 (Ops)",
    );
  });

  it("caps a long backlog and says how many more there are", () => {
    const text = reminderSection("Overdue", rows(140), 15);
    expect(text.split("\n")).toHaveLength(1 + 15 + 1);
    expect(text.startsWith("Overdue (140):")).toBe(true);
    expect(text.endsWith("...and 125 more in My tasks")).toBe(true);
  });

  it("leaves out empty sections", () => {
    expect(reminderSection("Overdue", [])).toBe("");
  });
});
