import { describe, expect, it } from "vitest";
import { dueBucket, formatDue, shiftDate, todayIn } from "@/lib/dates";
import { isEmailDomainAllowed } from "@/lib/email-domains";

// A Wednesday.
const today = "2026-09-30";

describe("formatDue", () => {
  it("uses relative words near today", () => {
    expect(formatDue("2026-09-30", today)).toBe("Today");
    expect(formatDue("2026-10-01", today)).toBe("Tomorrow");
    expect(formatDue("2026-09-29", today)).toBe("Yesterday");
  });

  it("uses weekday names for the coming week", () => {
    expect(formatDue("2026-10-03", today)).toBe("Saturday");
  });

  it("uses day and month further out, and adds the year when it differs", () => {
    expect(formatDue("2026-10-20", today)).toBe("20 Oct");
    expect(formatDue("2027-01-05", today)).toBe("5 Jan 2027");
    expect(formatDue("2026-09-01", today)).toBe("1 Sep");
  });
});

describe("dueBucket", () => {
  it("groups dates for My tasks", () => {
    expect(dueBucket(null, today)).toBe("no_date");
    expect(dueBucket("2026-09-28", today)).toBe("overdue");
    expect(dueBucket("2026-09-30", today)).toBe("today");
    expect(dueBucket("2026-10-01", today)).toBe("tomorrow");
    expect(dueBucket("2026-10-06", today)).toBe("this_week");
    expect(dueBucket("2026-10-07", today)).toBe("later");
  });
});

describe("date helpers", () => {
  it("shifts across month boundaries", () => {
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns an ISO date for a time zone", () => {
    expect(todayIn("Europe/London")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn("Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isEmailDomainAllowed", () => {
  it("allows everyone when no domains are configured", () => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    expect(isEmailDomainAllowed("anyone@example.com")).toBe(true);
  });

  it("restricts sign-ups to configured domains", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "acme.co.uk, @Studio.io";
    expect(isEmailDomainAllowed("sam@acme.co.uk")).toBe(true);
    expect(isEmailDomainAllowed("SAM@STUDIO.IO")).toBe(true);
    expect(isEmailDomainAllowed("sam@evil-acme.co.uk")).toBe(false);
    expect(isEmailDomainAllowed(undefined)).toBe(false);
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });
});
