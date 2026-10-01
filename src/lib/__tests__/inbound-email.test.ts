import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  MAX_ATTACHMENTS,
  addressesIn,
  cleanText,
  dmarcFailed,
  findWorkspaceKey,
  isAutomatic,
  parseInboundAddress,
  pickAttachments,
  taskDescription,
  taskTitle,
  workspaceAddress,
} from "../inbound-email";

const base = parseInboundAddress("Tasks@Digibooth.test")!;
const headers = (h: Record<string, string>) => new Map(Object.entries(h));

describe("inbound addresses", () => {
  it("parses the configured mailbox and builds plus addresses", () => {
    expect(base).toEqual({ local: "tasks", domain: "digibooth.test" });
    expect(workspaceAddress(base, "abc123def456")).toBe("tasks+abc123def456@digibooth.test");
  });

  it("refuses missing, plus or malformed addresses", () => {
    for (const bad of [undefined, "", "tasks", "tasks+x@digibooth.test", "a b@c.d", "tasks@local"]) {
      expect(parseInboundAddress(bad)).toBeNull();
    }
  });

  it("finds the workspace key among the recipients, ignoring other mailboxes", () => {
    expect(
      findWorkspaceKey(
        ["priya@digibooth.test", "other+abc123def456@digibooth.test", "TASKS+AbC123def456@digibooth.test"],
        base,
      ),
    ).toBe("abc123def456");
    expect(findWorkspaceKey(["tasks@digibooth.test"], base)).toBeNull();
    expect(findWorkspaceKey(["tasks+abc123def456@partner.example"], base)).toBeNull();
    expect(findWorkspaceKey(["tasks+short@digibooth.test"], base)).toBeNull();
  });

  it("pulls addresses out of header values", () => {
    expect(addressesIn(`"Okafor, Amara" <Amara@Digibooth.test>, owen@partner.example`)).toEqual([
      "amara@digibooth.test",
      "owen@partner.example",
    ]);
    expect(addressesIn(undefined)).toEqual([]);
  });
});

describe("cleanText", () => {
  it("drops control characters Postgres can’t store, keeping line breaks and tabs", () => {
    expect(cleanText("Broken\u0000 subject\u0007")).toBe("Broken subject");
    expect(cleanText("Line one\r\n\tLine two")).toBe("Line one\r\n\tLine two");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("taskTitle", () => {
  it("drops forwarding and reply prefixes, however many", () => {
    expect(taskTitle("Fwd: RE[2]: Fw:  Menu page   changes", "", "Amara")).toBe("Menu page changes");
    expect(taskTitle("AW: WG: Angebot", "", "Amara")).toBe("Angebot");
  });

  it("falls back to the first real line of the body, then the sender", () => {
    expect(taskTitle("", "\n---------- Forwarded message ---------\nCan you fix the form?", "Amara")).toBe(
      "Can you fix the form?",
    );
    expect(taskTitle("Re:", "  ", "Amara Okafor")).toBe("Email from Amara Okafor");
  });

  it("keeps titles within the task limit", () => {
    expect(taskTitle("x".repeat(500), "", "A")).toHaveLength(300);
  });
});

describe("taskDescription", () => {
  it("tidies line endings and blank runs", () => {
    expect(taskDescription("Hello \r\n\r\n\r\n\r\nThanks  \n")).toBe("Hello\n\nThanks");
  });

  it("notes attachments that were left out", () => {
    expect(taskDescription("Body", ["big.zip (over 25 MB)"])).toBe(
      "Body\n\nNot attached: big.zip (over 25 MB).",
    );
  });

  it("cuts long emails to the description limit and says so", () => {
    const out = taskDescription("a".repeat(DESCRIPTION_MAX * 2), ["x.pdf (over 25 MB)"]);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out).toContain("[Shortened");
    expect(out.endsWith("Not attached: x.pdf (over 25 MB).")).toBe(true);
  });
});

describe("automatic mail and forgery", () => {
  it("recognises auto-replies, bulk and list mail", () => {
    expect(isAutomatic(headers({ "auto-submitted": "auto-replied" }))).toBe(true);
    expect(isAutomatic(headers({ precedence: "bulk" }))).toBe(true);
    expect(isAutomatic(headers({ "x-autoreply": "yes" }))).toBe(true);
    expect(isAutomatic(headers({ "list-id": "<news.partner.example>" }))).toBe(true);
    expect(isAutomatic(headers({ "auto-submitted": "no" }))).toBe(false);
    expect(isAutomatic(headers({}))).toBe(false);
  });

  it("treats a recorded DMARC failure as forged, and nothing else", () => {
    expect(dmarcFailed(headers({ "authentication-results": "mx.example; spf=pass; dmarc=fail (p=REJECT)" }))).toBe(true);
    expect(dmarcFailed(headers({ "authentication-results": "mx.example; dkim=pass; dmarc=pass" }))).toBe(false);
    expect(dmarcFailed(headers({}))).toBe(false);
  });
});

describe("pickAttachments", () => {
  const MB = 1024 * 1024;

  it("keeps real files and skips inline images and receipts", () => {
    const { keep, skipped } = pickAttachments(
      [
        { filename: "brief.pdf", size: 2 * MB },
        { filename: "logo.png", size: 4000, related: true },
        { contentType: "message/delivery-status", size: 300 },
        { filename: "empty.txt", size: 0 },
      ],
      25 * MB,
    );
    expect(keep).toEqual([0]);
    expect(skipped).toEqual([]);
  });

  it("notes files over the size limit or beyond the count limit", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => ({ filename: `f${i}.txt`, size: 10 }));
    const { keep, skipped } = pickAttachments(
      [{ filename: "video.mov", size: 30 * MB }, ...many],
      25 * MB,
    );
    expect(keep).toHaveLength(MAX_ATTACHMENTS);
    expect(skipped[0]).toBe("video.mov (over 25 MB)");
    expect(skipped).toHaveLength(3);
  });
});
