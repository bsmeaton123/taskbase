import { describe, expect, it } from "vitest";
import { isValidColor, normalizeColor, workspaceSwatch } from "../colors";

describe("colours", () => {
  it("accepts palette keys and hex values, nothing else", () => {
    expect(isValidColor("blue")).toBe(true);
    expect(isValidColor("#1F6FE8")).toBe(true);
    expect(isValidColor("#1f6fe")).toBe(false);
    expect(isValidColor("red; background:url(x)")).toBe(false);
    expect(isValidColor("toString")).toBe(false);
    expect(isValidColor(null)).toBe(false);
  });

  it("normalises for storage and renders a swatch", () => {
    expect(normalizeColor("#1F6FE8")).toBe("#1f6fe8");
    expect(normalizeColor("teal")).toBe("teal");
    expect(normalizeColor("nonsense")).toBe("slate");
    expect(workspaceSwatch("#1f6fe8")).toBe("#1f6fe8");
    expect(workspaceSwatch("blue")).toMatch(/^oklch/);
    expect(workspaceSwatch("nonsense")).toMatch(/^oklch/);
  });
});
