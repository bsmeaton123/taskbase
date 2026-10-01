import { describe, expect, it } from "vitest";
import { signInHref } from "../request-path";
import { safeNext } from "../safe-next";

describe("signInHref", () => {
  it("sends people back to the page they asked for", () => {
    expect(signInHref("/my-tasks")).toBe("/sign-in?next=%2Fmy-tasks");
    expect(signInHref("/w/abc?task=xyz")).toBe("/sign-in?next=%2Fw%2Fabc%3Ftask%3Dxyz");
  });

  it("round-trips through the sign-in form's safeNext", () => {
    const href = signInHref("/w/abc?task=xyz&view=board");
    const next = new URL(href, "http://local").searchParams.get("next");
    expect(safeNext(next)).toBe("/w/abc?task=xyz&view=board");
  });

  it("adds nothing for the home page or a missing path", () => {
    expect(signInHref(null)).toBe("/sign-in");
    expect(signInHref("")).toBe("/sign-in");
    expect(signInHref("/")).toBe("/sign-in");
  });

  it("ignores anything that isn't a path on this site", () => {
    expect(signInHref("https://evil.example/")).toBe("/sign-in");
  });
});
