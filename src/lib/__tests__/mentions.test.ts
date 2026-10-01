import { describe, expect, it } from "vitest";
import {
  decodeMentions,
  encodeMentions,
  extractMentionIds,
  parseBody,
} from "@/lib/mentions";

const priya = { id: "u_priya", name: "Priya Raman" };
const pri = { id: "u_pri", name: "Pri" };

describe("encodeMentions", () => {
  it("turns @Name into a mention token", () => {
    expect(encodeMentions("Hey @Priya Raman, thoughts?", [priya])).toBe(
      "Hey @[Priya Raman](u_priya), thoughts?",
    );
  });

  it("prefers the longest matching name", () => {
    expect(encodeMentions("@Priya Raman and @Pri", [pri, priya])).toBe(
      "@[Priya Raman](u_priya) and @[Pri](u_pri)",
    );
  });

  it("ignores names embedded in email addresses", () => {
    expect(encodeMentions("mail priya@Priya Raman.com", [priya])).toBe(
      "mail priya@Priya Raman.com",
    );
  });

  it("round-trips through decodeMentions", () => {
    const encoded = encodeMentions("cc @Priya Raman", [priya]);
    const decoded = decodeMentions(encoded);
    expect(decoded.text).toBe("cc @Priya Raman");
    expect(decoded.people).toEqual([priya]);
    expect(encodeMentions(decoded.text, decoded.people)).toBe(encoded);
  });
});

describe("extractMentionIds", () => {
  it("returns unique ids", () => {
    expect(
      extractMentionIds("@[Priya Raman](u_priya) @[Pri](u_pri) @[Priya Raman](u_priya)"),
    ).toEqual(["u_priya", "u_pri"]);
  });
});

describe("parseBody", () => {
  it("splits text, mentions and links", () => {
    expect(parseBody("See https://example.com/a. Thanks @[Pri](u_pri)!")).toEqual([
      { type: "text", value: "See " },
      { type: "link", href: "https://example.com/a" },
      { type: "text", value: ". Thanks " },
      { type: "mention", name: "Pri", id: "u_pri" },
      { type: "text", value: "!" },
    ]);
  });
});
