import { describe, expect, it } from "vitest";
import { filterNavSections, isLeafActive, NAV_SECTIONS, type NavSection } from "./navigation";

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
    // Manufacturing: BOM/MRP -> bom_mrp, Production + Job Work Orders + My Work -> production.view.
    // "Pending Approvals" additionally requires production.approve (requiredAction) —
    // absent here since no actionModules were supplied, matching a
    // PRODUCTION_WORKER/EXTERNAL_UNIT_USER who holds production.view but not
    // production.approve (RBAC audit, 2026-09-24 — this used to incorrectly
    // show the link, which then 404'd on click).
    const result = filterNavSections(NAV_SECTIONS, ["dashboard", "production"]);
    const manufacturing = result.find((s) => s.label === "Manufacturing");
    expect(manufacturing?.children?.map((c) => c.label)).toEqual(["Production", "Job Work Orders", "My Work"]);
  });

  it("shows 'Pending Approvals' only once the viewer's actionModules confirms production.approve", () => {
    const result = filterNavSections(NAV_SECTIONS, ["dashboard", "production"], { approve: ["production"] });
    const manufacturing = result.find((s) => s.label === "Manufacturing");
    expect(manufacturing?.children?.map((c) => c.label)).toEqual([
      "Production",
      "Job Work Orders",
      "My Work",
      "Pending Approvals",
    ]);
  });

  it("shows every leaf's requiredAction as satisfied when the viewer is fully unrestricted (\"all\")", () => {
    const result = filterNavSections(NAV_SECTIONS, "all");
    const manufacturing = result.find((s) => s.label === "Manufacturing");
    expect(manufacturing?.children?.map((c) => c.label)).toContain("Pending Approvals");
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

describe("isLeafActive", () => {
  const crm = NAV_SECTIONS.find((s) => s.label === "CRM")!;
  const leaf = (label: string) => crm.children!.find((c) => c.label === label)!;

  it("highlights only the most specific matching child", () => {
    expect(isLeafActive(crm.children!, leaf("Activity Log"), "/crm/activity")).toBe(true);
    expect(isLeafActive(crm.children!, leaf("Dashboard"), "/crm/activity")).toBe(false);
  });

  it("still highlights the parent-path child on its own page", () => {
    expect(isLeafActive(crm.children!, leaf("Dashboard"), "/crm")).toBe(true);
    expect(isLeafActive(crm.children!, leaf("Activity Log"), "/crm")).toBe(false);
  });
});
