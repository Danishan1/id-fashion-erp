import { describe, expect, it } from "vitest";
import { filterNavSections, NAV_SECTIONS, type NavSection } from "./navigation";

describe("filterNavSections", () => {
  it("returns every section unchanged when the viewer is unrestricted (\"all\")", () => {
    const result = filterNavSections(NAV_SECTIONS, "all");
    expect(result).toEqual(NAV_SECTIONS);
  });

  it("drops a childless section entirely when the viewer lacks its module", () => {
    const result = filterNavSections(NAV_SECTIONS, ["dashboard"]);
    expect(result.map((s) => s.label)).toEqual(["Dashboard"]);
  });

  it("keeps a parent section but only its visible children when some, not all, child modules are granted", () => {
    // Manufacturing: BOM/MRP -> bom_mrp, Production + Job Work Orders -> production.
    const result = filterNavSections(NAV_SECTIONS, ["dashboard", "production"]);
    const manufacturing = result.find((s) => s.label === "Manufacturing");
    expect(manufacturing?.children?.map((c) => c.label)).toEqual(["Production", "Job Work Orders"]);
  });

  it("keeps a section with no href visible via its children even though the section itself has no module of its own reachable directly", () => {
    // HRMS has no top-level href/module of its own significance beyond its children's modules.
    const result = filterNavSections(NAV_SECTIONS, ["hrms_leave"]);
    const hrms = result.find((s) => s.label === "HRMS");
    expect(hrms?.children?.map((c) => c.label)).toEqual(["Leave Requests", "Leave Types"]);
  });

  it("drops a section with children entirely when none of its children (or its own modules) are granted", () => {
    const result = filterNavSections(NAV_SECTIONS, ["dashboard"]);
    expect(result.find((s) => s.label === "HRMS")).toBeUndefined();
    expect(result.find((s) => s.label === "Manufacturing")).toBeUndefined();
  });

  it("shows a single-link section granted via any one of several eligible modules (Accounts)", () => {
    const result = filterNavSections(NAV_SECTIONS, ["expenses"]);
    expect(result.map((s) => s.label)).toContain("Accounts");
  });

  it("real-world scenario: a floor role scoped only to production sees just Dashboard + Manufacturing", () => {
    const result = filterNavSections(NAV_SECTIONS, ["dashboard", "production"]);
    expect(result.map((s) => s.label)).toEqual(["Dashboard", "Manufacturing"]);
  });

  it("every section/leaf declares a real, non-empty modules array (except the Platform section, added separately by Sidebar)", () => {
    for (const section of NAV_SECTIONS as NavSection[]) {
      expect(section.modules.length).toBeGreaterThan(0);
      for (const child of section.children ?? []) {
        expect(child.modules.length).toBeGreaterThan(0);
      }
    }
  });
});
