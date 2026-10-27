import { describe, expect, it } from "vitest";
import { MODULES } from "./rbac";
import { PERMISSION_GROUPS, moduleLabel, relevantActions } from "./permission-groups";

describe("permission groups (P6)", () => {
  it("puts every RBAC module in exactly one group", () => {
    const all = PERMISSION_GROUPS.flatMap((g) => g.modules);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...MODULES].sort());
  });

  it("offers only actions some built-in role uses, always including view", () => {
    const hrms = relevantActions("hrms_leave");
    expect(hrms).toContain("view");
    expect(hrms).toContain("approve");
    expect(hrms).not.toContain("scan");
  });

  it("labels modules readably", () => {
    expect(moduleLabel("masters_core")).toBe("Masters core");
    expect(moduleLabel("hrms_leave")).toBe("Leave Requests");
  });
});
