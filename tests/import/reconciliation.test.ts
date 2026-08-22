import { describe, expect, it } from "vitest";
import { reconcileStaffIdentities } from "../../src/application/import/reconciliation";

const source = { artifactId: "a", sheetIndex: 0, sheetName: "Roster", row: 4, column: 2, address: "B4" };

describe("staff identity reconciliation", () => {
  it("uses immutable Staff No. and queues unknown names", () => {
    const result = reconcileStaffIdentities(
      [{ rawName: "Chan Wai", staffNumber: "S001", source }, { rawName: "Unknown", source: { ...source, row: 5 } }],
      [{ staffNumber: "S001", displayName: "Chan Wai" }],
      [],
      "2026-08-21T00:00:00.000Z",
    );
    expect(result.resolved.get("a:0:4:2")).toBe("S001");
    expect(result.exceptions[0]?.code).toBe("UNRESOLVED_STAFF_ALIAS");
  });

  it("requires an explicit decision before accepting a name candidate", () => {
    const candidate = reconcileStaffIdentities([{ rawName: "Chan Wai", source }], [{ staffNumber: "S001", displayName: "Chan Wai" }]);
    expect(candidate.resolved.size).toBe(0);
    const accepted = reconcileStaffIdentities(
      [{ rawName: "Chan Wai", source }],
      [{ staffNumber: "S001", displayName: "Chan Wai" }],
      [{ aliasId: "a:0:4:2", status: "accepted", staffNumber: "S001" }],
    );
    expect(accepted.resolved.get("a:0:4:2")).toBe("S001");
  });
});
