import { describe, expect, it } from "vitest";
import {
  htmlToText,
  mapStatus,
  normaliseEmail,
  personName,
  rbDate,
  rbName,
  rbText,
  rbTime,
} from "../redbooth";

describe("mapStatus", () => {
  it("maps Redbooth's statuses onto taskbase's", () => {
    expect(mapStatus("new")).toBe("open");
    expect(mapStatus("open")).toBe("open");
    expect(mapStatus("hold")).toBe("on_hold");
    expect(mapStatus("resolved")).toBe("resolved");
    expect(mapStatus("rejected")).toBe("rejected");
    expect(mapStatus(undefined)).toBe("open");
    expect(mapStatus("something-new")).toBe("open");
  });
});

describe("rbTime", () => {
  it("reads Unix seconds, numeric strings, milliseconds and ISO strings", () => {
    expect(rbTime(1727771400)?.toISOString()).toBe("2024-10-01T08:30:00.000Z");
    expect(rbTime("1727771400")?.toISOString()).toBe("2024-10-01T08:30:00.000Z");
    expect(rbTime(1727771400000)?.toISOString()).toBe("2024-10-01T08:30:00.000Z");
    expect(rbTime("2024-10-01T08:30:00Z")?.toISOString()).toBe("2024-10-01T08:30:00.000Z");
  });

  it("returns null for missing or nonsense values", () => {
    for (const v of [null, undefined, "", 0, -5, "soon", {}]) expect(rbTime(v)).toBeNull();
  });
});

describe("rbDate", () => {
  it("keeps valid due dates the app accepts", () => {
    expect(rbDate("2026-10-15")).toBe("2026-10-15");
    expect(rbDate("2026-10-15T00:00:00Z")).toBe("2026-10-15");
    expect(rbDate(1727771400)).toBe("2024-10-01");
  });

  it("drops impossible or out-of-range dates", () => {
    expect(rbDate("2026-02-30")).toBeNull();
    expect(rbDate("1999-12-31")).toBeNull();
    expect(rbDate("2100-01-01")).toBeNull();
    expect(rbDate(null)).toBeNull();
  });
});

describe("text", () => {
  it("turns HTML into readable text", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul>")).toBe(
      "Hello & welcome\n\n- One\n- Two\n",
    );
    expect(htmlToText("a<br>b<script>alert(1)</script>&#39;c&#x41;")).toBe("a\nb'cA");
  });

  it("prefers the plain field, falls back to HTML, tidies and caps", () => {
    expect(rbText("  Plain  \r\n\r\n\r\n\r\nnext ", "<p>html</p>", 100)).toBe("Plain\n\nnext");
    expect(rbText("", "<p>From html</p>", 100)).toBe("From html");
    expect(rbText(null, null, 100)).toBe("");
    expect(rbText("x".repeat(50), null, 10)).toHaveLength(10);
  });

  it("names are one line with a fallback", () => {
    expect(rbName("  Design \n  review ", 80, "Untitled")).toBe("Design review");
    expect(rbName("", 80, "Untitled")).toBe("Untitled");
    expect(rbName("y".repeat(100), 80, "Untitled")).toHaveLength(80);
  });
});

describe("people", () => {
  it("builds a display name from whatever is set", () => {
    expect(personName({ first_name: "Nadia", last_name: "Brooks" })).toBe("Nadia Brooks");
    expect(personName({ username: "owen" })).toBe("owen");
    expect(personName({ email: "a@b.co" })).toBe("a@b.co");
    expect(personName({})).toBe("Someone");
  });

  it("normalises emails for matching", () => {
    expect(normaliseEmail("  Owen@Example.COM ")).toBe("owen@example.com");
    expect(normaliseEmail("not-an-email")).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
  });
});
