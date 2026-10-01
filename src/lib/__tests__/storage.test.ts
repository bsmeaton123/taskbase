import { afterEach, describe, expect, it, vi } from "vitest";
import { isInlineSafe, maxUploadBytes, sanitizeFileName } from "../storage";

afterEach(() => vi.unstubAllEnvs());

describe("sanitizeFileName", () => {
  it("drops any folder part, so names can't point elsewhere", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("removes control characters and quotes that would break headers", () => {
    expect(sanitizeFileName('bad"name\r\n.txt')).toBe("badname.txt");
    expect(sanitizeFileName("tab\there.txt")).toBe("tabhere.txt");
  });

  it("never returns an empty or huge name", () => {
    expect(sanitizeFileName("   ")).toBe("file");
    expect(sanitizeFileName("dir/")).toBe("file");
    expect(sanitizeFileName("a".repeat(500))).toHaveLength(200);
  });
});

describe("isInlineSafe", () => {
  it("shows images and PDFs inline, never scriptable types", () => {
    expect(isInlineSafe("image/png")).toBe(true);
    expect(isInlineSafe("application/pdf")).toBe(true);
    expect(isInlineSafe("image/svg+xml")).toBe(false);
    expect(isInlineSafe("text/html")).toBe(false);
    expect(isInlineSafe("application/xhtml+xml")).toBe(false);
  });
});

describe("maxUploadBytes", () => {
  it("defaults to 10 MB and ignores nonsense", () => {
    vi.stubEnv("MAX_UPLOAD_MB", "");
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
    vi.stubEnv("MAX_UPLOAD_MB", "-5");
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
    vi.stubEnv("MAX_UPLOAD_MB", "lots");
    expect(maxUploadBytes()).toBe(10 * 1024 * 1024);
    vi.stubEnv("MAX_UPLOAD_MB", "25");
    expect(maxUploadBytes()).toBe(25 * 1024 * 1024);
  });
});
