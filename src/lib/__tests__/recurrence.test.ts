import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  nextOccurrence,
  recurrenceSchema,
  sameRecurrence,
  type Recurrence,
} from "../recurrence";

// 2026-10-05 is a Monday.
const next = (rule: Recurrence, due: string | null, completedOn: string, today = completedOn) =>
  nextOccurrence(rule, { due, completedOn, today });

describe("nextOccurrence", () => {
  it("daily and every N days", () => {
    expect(next({ freq: "daily", interval: 1 }, "2026-10-05", "2026-10-05")).toBe("2026-10-06");
    expect(next({ freq: "daily", interval: 3 }, "2026-10-05", "2026-10-05")).toBe("2026-10-08");
  });

  it("weekly keeps the weekday", () => {
    expect(next({ freq: "weekly", interval: 1 }, "2026-10-05", "2026-10-05")).toBe("2026-10-12");
    expect(next({ freq: "weekly", interval: 2 }, "2026-10-05", "2026-10-05")).toBe("2026-10-19");
  });

  it("weekly on chosen days", () => {
    const monThu: Recurrence = { freq: "weekly", interval: 1, weekdays: [1, 4] };
    expect(next(monThu, "2026-10-05", "2026-10-05")).toBe("2026-10-08"); // Mon -> Thu
    expect(next(monThu, "2026-10-08", "2026-10-08")).toBe("2026-10-12"); // Thu -> Mon
  });

  it("every 2 weeks on chosen days skips the off week", () => {
    const rule: Recurrence = { freq: "weekly", interval: 2, weekdays: [1, 4] };
    expect(next(rule, "2026-10-05", "2026-10-05")).toBe("2026-10-08"); // same week
    expect(next(rule, "2026-10-08", "2026-10-08")).toBe("2026-10-19"); // skips week of 12th
  });

  it("weekdays skip the weekend", () => {
    const rule: Recurrence = { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] };
    expect(next(rule, "2026-10-09", "2026-10-09")).toBe("2026-10-12"); // Fri -> Mon
  });

  it("monthly clamps to short months and keeps the original day", () => {
    const rule: Recurrence = { freq: "monthly", interval: 1, monthDay: 31 };
    expect(next(rule, "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(next(rule, "2026-02-28", "2026-02-28")).toBe("2026-03-31");
  });

  it("monthly on the last day", () => {
    const rule: Recurrence = { freq: "monthly", interval: 1, monthDay: -1 };
    expect(next(rule, "2026-10-31", "2026-10-31")).toBe("2026-11-30");
    expect(next(rule, "2026-11-30", "2026-11-30")).toBe("2026-12-31");
  });

  it("every 3 months uses the due date's day when none is set", () => {
    expect(next({ freq: "monthly", interval: 3 }, "2026-10-15", "2026-10-15")).toBe("2027-01-15");
  });

  it("yearly, including 29 February", () => {
    expect(next({ freq: "yearly", interval: 1 }, "2026-10-05", "2026-10-05")).toBe("2027-10-05");
    expect(next({ freq: "yearly", interval: 1 }, "2028-02-29", "2028-02-29")).toBe("2029-02-28");
  });

  it("a late completion on a fixed schedule jumps to the next date that hasn't passed", () => {
    // Weekly on Mondays, due 5 Oct, finished on Thursday 22 Oct: next is Monday 26 Oct.
    expect(next({ freq: "weekly", interval: 1 }, "2026-10-05", "2026-10-22")).toBe("2026-10-26");
    // Due today is fine.
    expect(next({ freq: "weekly", interval: 1 }, "2026-10-05", "2026-10-12")).toBe("2026-10-12");
  });

  it("from completion counts from the day it was done", () => {
    const rule: Recurrence = { freq: "daily", interval: 10, from: "completion" };
    expect(next(rule, "2026-10-05", "2026-10-09")).toBe("2026-10-19");
  });

  it("tasks without a due date repeat from completion", () => {
    expect(next({ freq: "weekly", interval: 1 }, null, "2026-10-07")).toBe("2026-10-14");
  });

  it("stops after the end date", () => {
    const rule: Recurrence = { freq: "weekly", interval: 1, until: "2026-10-10" };
    expect(next(rule, "2026-10-05", "2026-10-05")).toBeNull();
    expect(next({ ...rule, until: "2026-10-12" }, "2026-10-05", "2026-10-05")).toBe("2026-10-12");
  });
});

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence({ freq: "daily", interval: 1 })).toBe("Every day");
    expect(describeRecurrence({ freq: "daily", interval: 3 })).toBe("Every 3 days");
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] })).toBe(
      "Every weekday",
    );
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [1] })).toBe(
      "Every week on Monday",
    );
    expect(describeRecurrence({ freq: "weekly", interval: 2, weekdays: [4, 1] })).toBe(
      "Every 2 weeks on Mon, Thu",
    );
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [0, 6] })).toBe(
      "Every week on Sat, Sun",
    );
    expect(describeRecurrence({ freq: "monthly", interval: 1 }, "2026-10-22")).toBe(
      "Every month on the 22nd",
    );
    expect(describeRecurrence({ freq: "monthly", interval: 1, monthDay: -1 })).toBe(
      "Every month on the last day",
    );
    expect(describeRecurrence({ freq: "yearly", interval: 1 }, "2026-03-03")).toBe(
      "Every year on 3 March",
    );
    expect(describeRecurrence({ freq: "daily", interval: 10, from: "completion" })).toBe(
      "Every 10 days after it's done",
    );
    expect(
      describeRecurrence({ freq: "weekly", interval: 1, weekdays: [1], until: "2026-12-18" }),
    ).toBe("Every week on Monday, until 18 Dec 2026");
  });
});

describe("recurrenceSchema and sameRecurrence", () => {
  it("validates rules", () => {
    expect(recurrenceSchema.safeParse({ freq: "weekly", interval: 1, weekdays: [1] }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ freq: "weekly", interval: 0 }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "hourly", interval: 1 }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "monthly", interval: 1, monthDay: 0 }).success).toBe(false);
  });

  it("compares rules by meaning", () => {
    expect(
      sameRecurrence(
        { freq: "weekly", interval: 1, weekdays: [4, 1] },
        { freq: "weekly", interval: 1, weekdays: [1, 4], from: "due" },
      ),
    ).toBe(true);
    expect(sameRecurrence({ freq: "daily", interval: 1 }, null)).toBe(false);
  });
});

describe("drift and catch-up", () => {
  it("yearly rules come back to 29 February in leap years", () => {
    expect(next({ freq: "yearly", interval: 1 }, "2028-02-29", "2028-02-29")).toBe("2029-02-28");
    // The original day is remembered, so the leap year after gets the 29th again.
    expect(
      nextOccurrence({ freq: "yearly", interval: 1 }, { due: "2028-02-29", completedOn: "2031-03-01", today: "2031-03-01" }),
    ).toBe("2032-02-29");
  });

  it("catches up a very old daily task in one jump, to today or later", () => {
    const r = next({ freq: "daily", interval: 1 }, "2020-01-01", "2026-10-01");
    expect(r).toBe("2026-10-01");
    expect(next({ freq: "daily", interval: 3 }, "2020-01-01", "2026-10-01")! >= "2026-10-01").toBe(true);
  });

  it("catches up old weekly and monthly schedules without landing in the past", () => {
    expect(next({ freq: "weekly", interval: 2 }, "2020-01-06", "2026-10-01")! >= "2026-10-01").toBe(true);
    expect(next({ freq: "monthly", interval: 1, monthDay: 31 }, "2020-01-31", "2026-10-01")).toBe("2026-10-31");
    expect(next({ freq: "weekly", interval: 1, weekdays: [1, 4] }, "2020-01-06", "2026-10-01")).toBe("2026-10-01");
  });
});

describe("shiftRecurrence", () => {
  it("moves a rule tied to the old due date along with it", async () => {
    const { shiftRecurrence } = await import("../recurrence");
    // Monthly on the 15th, task moved from the 15th to the 18th.
    expect(shiftRecurrence({ freq: "monthly", interval: 1, monthDay: 15 }, "2026-01-15", "2026-01-18").monthDay).toBe(18);
    // Weekly on Monday (2026-10-05), moved to Wednesday.
    expect(shiftRecurrence({ freq: "weekly", interval: 1, weekdays: [1] }, "2026-10-05", "2026-10-07").weekdays).toEqual([3]);
    // Several weekdays are a deliberate pattern and stay put.
    expect(shiftRecurrence({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }, "2026-10-05", "2026-10-07").weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves rules alone when they weren't tied to the due date, or nothing moved", async () => {
    const { shiftRecurrence } = await import("../recurrence");
    const lastDay = { freq: "monthly" as const, interval: 1, monthDay: -1 };
    expect(shiftRecurrence(lastDay, "2026-01-15", "2026-01-18")).toEqual(lastDay);
    const daily = { freq: "daily" as const, interval: 2 };
    expect(shiftRecurrence(daily, "2026-01-15", "2026-01-18")).toEqual(daily);
    const weekly = { freq: "weekly" as const, interval: 1, weekdays: [1] };
    expect(shiftRecurrence(weekly, "2026-10-05", null)).toEqual(weekly);
  });
});
