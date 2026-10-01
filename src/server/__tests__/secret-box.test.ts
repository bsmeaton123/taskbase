import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open, seal } from "../secret-box";

beforeEach(() => vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-one"));
afterEach(() => vi.unstubAllEnvs());

describe("secret box", () => {
  it("round-trips, and never stores the plain text", () => {
    const sealed = seal("refresh-token-123", "redbooth");
    expect(sealed).not.toContain("refresh-token-123");
    expect(open(sealed, "redbooth")).toBe("refresh-token-123");
  });

  it("uses a fresh nonce each time", () => {
    expect(seal("same", "redbooth")).not.toBe(seal("same", "redbooth"));
  });

  it("won't open for another purpose, another key, or after tampering", () => {
    const sealed = seal("secret", "redbooth");
    expect(open(sealed, "slack")).toBeNull();

    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    expect(open([...parts.slice(0, 3), flipped.toString("base64url")].join("."), "redbooth")).toBeNull();
    expect(open("garbage", "redbooth")).toBeNull();

    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-two");
    expect(open(sealed, "redbooth")).toBeNull();
  });
});
