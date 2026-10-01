import { describe, expect, it } from "vitest";
import {
  guessDateOrder,
  guessMapping,
  matchPeople,
  matchPerson,
  parseCsv,
  parseDate,
  parseStatus,
  parseUrgent,
  splitPeople,
} from "@/lib/csv-import";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields", () => {
    const csv = 'Task,Notes\r\n"Write copy, v2","He said ""ship it""\nthen left"\r\nPlain,\n';
    expect(parseCsv(csv)).toEqual([
      ["Task", "Notes"],
      ["Write copy, v2", 'He said "ship it"\nthen left'],
      ["Plain", ""],
    ]);
  });

  it("detects semicolons and tabs, strips BOM and blank lines", () => {
    expect(parseCsv("﻿a;b\n1;2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("guessMapping", () => {
  it("matches common export headers", () => {
    expect(
      guessMapping(["Task name", "Task List", "Assigned to", "Due Date", "Status", "Description"]),
    ).toEqual({ title: 0, list: 1, assignee: 2, dueDate: 3, status: 4, description: 5 });
  });
});

describe("dates", () => {
  it("guesses day-first vs month-first", () => {
    expect(guessDateOrder(["03/04/2026", "25/12/2026"])).toBe("dmy");
    expect(guessDateOrder(["12/31/2026"])).toBe("mdy");
  });

  it("parses ISO, day-first, month-first and rejects impossible dates", () => {
    expect(parseDate("2026-10-05", "dmy")).toBe("2026-10-05");
    expect(parseDate("2026-10-05T09:00:00Z", "dmy")).toBe("2026-10-05");
    expect(parseDate("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(parseDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
    expect(parseDate("soon", "dmy")).toBeNull();
    expect(parseDate("", "dmy")).toBeNull();
  });
});

describe("status, urgency and people", () => {
  it("maps status words", () => {
    expect(parseStatus("Done")).toBe("resolved");
    expect(parseStatus("In Progress")).toBe("in_progress");
    expect(parseStatus("on_hold")).toBe("on_hold");
    expect(parseStatus("Cancelled")).toBe("rejected");
    expect(parseStatus("anything else")).toBe("open");
    expect(parseUrgent("High")).toBe(true);
    expect(parseUrgent("normal")).toBe(false);
  });

  it("matches people by email, full name, or unique first name", () => {
    const people = [
      { id: "1", name: "Priya Raman", email: "priya@x.test" },
      { id: "2", name: "Sam Ortiz", email: "sam.o@x.test" },
      { id: "3", name: "Sam Price", email: "sam.p@x.test" },
    ];
    expect(matchPerson("PRIYA@x.test", people)?.id).toBe("1");
    expect(matchPerson("sam price", people)?.id).toBe("3");
    expect(matchPerson("Priya", people)?.id).toBe("1");
    expect(matchPerson("Sam", people)).toBeNull();
    expect(matchPerson("Nobody", people)).toBeNull();
  });
});

describe("several assignees in one cell", () => {
  const people = [
    { id: "1", name: "Priya Raman", email: "priya@x.test" },
    { id: "2", name: "Sam Ortiz", email: "sam.o@x.test" },
    { id: "3", name: "Lee Anderson", email: "lee@x.test" },
    { id: "4", name: "Smith, Jo", email: "jo@x.test" },
  ];
  const ids = (cell: string) => matchPeople(cell, people).matched.map((p) => p.id);

  it("splits on commas, semicolons, ampersands and “and”", () => {
    expect(splitPeople("Priya, Sam; Lee and Ana & Jo")).toEqual(["Priya", "Sam", "Lee", "Ana", "Jo"]);
    expect(splitPeople(" Priya AND  Sam ")).toEqual(["Priya", "Sam"]);
    // "and" inside a name isn't a separator.
    expect(splitPeople("Lee Anderson")).toEqual(["Lee Anderson"]);
    expect(splitPeople("")).toEqual([]);
  });

  it("matches each person, keeps the order and drops repeats", () => {
    expect(ids("Sam Ortiz, priya@x.test")).toEqual(["2", "1"]);
    expect(ids("Priya and Lee Anderson")).toEqual(["1", "3"]);
    expect(ids("lee@x.test; Priya; Priya Raman")).toEqual(["3", "1"]);
    expect(ids("Sam Ortiz")).toEqual(["2"]);
  });

  it("reports names that match nobody", () => {
    expect(matchPeople("Priya, Nobody and Ghost", people)).toEqual({
      matched: [people[0]],
      unmatched: ["Nobody", "Ghost"],
    });
  });

  it("still matches a whole cell that is one person's name with a comma in it", () => {
    expect(ids("Smith, Jo")).toEqual(["4"]);
  });
});

describe("parseTags", () => {
  it("splits on commas, semicolons and pipes, trims and de-duplicates", async () => {
    const { parseTags } = await import("../csv-import");
    expect(parseTags("Design, Web;design | Launch  week ")).toEqual(["Design", "Web", "Launch week"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(","))).toHaveLength(10);
  });
});

describe("real export shapes", () => {
  it("reads day-first dates that carry a time", async () => {
    const { parseDate } = await import("../csv-import");
    expect(parseDate("03/04/2026 09:00", "dmy")).toBe("2026-04-03");
    expect(parseDate("25/12/2026 09:00", "dmy")).toBe("2026-12-25");
    expect(parseDate("12/25/2026 9:00 AM", "mdy")).toBe("2026-12-25");
    expect(parseDate("2026-04-03T09:00:00Z", "dmy")).toBe("2026-04-03");
  });

  it("prefers the best header for each field, not the first synonym hit", async () => {
    const { guessMapping } = await import("../csv-import");
    const m = guessMapping(["Project", "Task List", "Name", "Assignee"]);
    expect(m.list).toBe(1);
    expect(m.title).toBe(2);
  });

  it("maps Asana and Trello export headers", async () => {
    const { guessMapping, parseStatus } = await import("../csv-import");
    const asana = guessMapping(["Task ID", "Created At", "Completed At", "Name", "Section/Column", "Assignee", "Assignee Email", "Due Date", "Tags", "Notes"]);
    expect(asana.title).toBe(3);
    expect(asana.list).toBe(4);
    expect(asana.status).toBe(2);
    expect(asana.tags).toBe(8);
    expect(asana.description).toBe(9);
    const trello = guessMapping(["Card Name", "Card Description", "List Name", "Members", "Labels", "Due Date", "Due Complete"]);
    expect(trello.title).toBe(0);
    expect(trello.description).toBe(1);
    expect(trello.list).toBe(2);
    expect(trello.assignee).toBe(3);
    expect(trello.tags).toBe(4);
    expect(trello.status).toBe(6);
    // A "Completed At" timestamp means done; an empty one means open.
    expect(parseStatus("2026-03-01T10:00:00Z")).toBe("resolved");
    expect(parseStatus("")).toBe("open");
  });
});
