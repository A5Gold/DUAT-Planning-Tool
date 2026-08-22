import { describe, expect, it } from "vitest";
import { resolveEffectiveRosterForStaff, resolveRosterCode, s40GradeDefault } from "../../src/application/import/rosterResolver";

describe("roster resolver", () => {
  it("uses S40 weekday Day and weekend Rest defaults", () => {
    expect(s40GradeDefault("2026-08-21").rawCode).toBe("D");
    expect(s40GradeDefault("2026-08-22")).toMatchObject({ rawCode: "Rest", availability: "unavailable" });
  });

  it("applies grade default, team baseline, then non-empty staff override", () => {
    const inherited = resolveEffectiveRosterForStaff({
      staffNumber: "668695", date: "2026-08-21", grade: "S40", teamBaseline: "N", staffOverride: "", parserVersion: "roster-v1",
    });
    expect(inherited.effective).toMatchObject({ rawCode: "N", sourceLayer: "team-baseline", availability: "confirmed-available" });

    const overridden = resolveEffectiveRosterForStaff({
      staffNumber: "668695", date: "2026-08-21", grade: "S40", teamBaseline: "N", staffOverride: "AL", parserVersion: "roster-v1",
    });
    expect(overridden.effective).toMatchObject({ rawCode: "AL", sourceLayer: "staff-override", availability: "unavailable" });
  });

  it("does not guess compound or unmapped codes", () => {
    expect(resolveRosterCode("D+N").value).toMatchObject({ rawCode: "D+N", availability: "unknown" });
    expect(resolveRosterCode("T01").value).toMatchObject({ rawCode: "T01", availability: "unknown" });
    expect(resolveRosterCode("T01").issue).toMatchObject({ code: "UNKNOWN_ROSTER_CODE", severity: "blocking" });
  });
});
