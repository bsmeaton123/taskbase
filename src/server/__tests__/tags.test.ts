import { describe, expect, it } from "vitest";
import { cleanTagName, pickTagColor, TAG_NAME_MAX } from "../tags";

describe("cleanTagName", () => {
  it("trims, collapses spaces and caps the length", () => {
    expect(cleanTagName("  Launch    blocker ")).toBe("Launch blocker");
    expect(cleanTagName("x".repeat(100))).toHaveLength(TAG_NAME_MAX);
  });
});

describe("pickTagColor", () => {
  it("picks the least-used colour, leaving grey for last", () => {
    const first = pickTagColor([]);
    expect(first).not.toBe("slate");
    expect(pickTagColor([first])).not.toBe(first);
  });

  it("only falls back to grey once every other colour is in use as often", () => {
    const palette: string[] = [];
    let next = pickTagColor(palette);
    while (next !== "slate") {
      palette.push(next);
      next = pickTagColor(palette);
    }
    expect(new Set(palette).size).toBe(palette.length);
    expect(palette).not.toContain("slate");
  });
});
