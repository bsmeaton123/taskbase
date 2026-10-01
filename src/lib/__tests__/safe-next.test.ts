import { describe, expect, it } from "vitest";
import { safeNext } from "../safe-next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/my-tasks")).toBe("/my-tasks");
    expect(safeNext("/w/abc?task=x#c")).toBe("/w/abc?task=x#c");
  });

  it("sends anything that could leave the site home", () => {
    for (const bad of [
      null,
      "",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "/\t/evil.com", // the URL parser strips tabs, leaving //evil.com
      "/\n/evil.com",
      "javascript:alert(1)",
      "evil.com/path",
    ])
      expect(safeNext(bad)).toBe("/");
  });
});
