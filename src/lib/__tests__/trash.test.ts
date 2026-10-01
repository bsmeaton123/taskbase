import { describe, expect, it } from "vitest";
import { diskFilesIn } from "../trash";

describe("diskFilesIn", () => {
  it("collects only on-disk files across snapshots", () => {
    const snapshots = [
      { attachments: [{ id: "a1", storage: "disk" }, { id: "a2", storage: "db" }] },
      { attachments: [] },
      { attachments: [{ id: "b1", storage: "disk" }] },
    ];
    expect(diskFilesIn(snapshots)).toEqual(["a1", "b1"]);
  });

  it("copes with snapshots that have no attachments list", () => {
    expect(diskFilesIn([{}, { attachments: null }])).toEqual([]);
  });
});
