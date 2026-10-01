import { afterEach, describe, expect, it, vi } from "vitest";
import { canBootstrap } from "../invites";

afterEach(() => vi.unstubAllEnvs());

describe("canBootstrap (who may create the first, admin, account)", () => {
  it("only ADMIN_EMAIL when it's set, ignoring case and spaces", () => {
    vi.stubEnv("ADMIN_EMAIL", " Boss@Example.com ");
    expect(canBootstrap("boss@example.com")).toBe(true);
    expect(canBootstrap("  BOSS@example.COM")).toBe(true);
    expect(canBootstrap("someone@example.com")).toBe(false);
    expect(canBootstrap(undefined)).toBe(false);
    expect(canBootstrap(["boss@example.com"])).toBe(false);
  });

  it("nobody in production without ADMIN_EMAIL, anyone in development", () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(canBootstrap("anyone@example.com")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(canBootstrap("anyone@example.com")).toBe(true);
  });
});
