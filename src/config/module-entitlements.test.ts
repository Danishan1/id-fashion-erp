import { describe, expect, it } from "vitest";
import { MODULES } from "@/config/rbac";
import { CORE_MODULES, ENTITLEMENT_PACKAGES, modulesOfPackages, packageForModule } from "./module-entitlements";

describe("module entitlement catalog", () => {
  it("covers every RBAC module exactly once — either core or in exactly one package", () => {
    for (const mod of MODULES) {
      const owners = ENTITLEMENT_PACKAGES.filter((p) => (p.modules as readonly string[]).includes(mod));
      const isCore = (CORE_MODULES as readonly string[]).includes(mod);
      expect({ mod, count: owners.length + (isCore ? 1 : 0) }).toEqual({ mod, count: 1 });
    }
  });

  it("never lists a module that does not exist", () => {
    const known = new Set<string>(MODULES);
    for (const p of ENTITLEMENT_PACKAGES) for (const m of p.modules) expect(known.has(m)).toBe(true);
  });

  it("keeps sales orders and administration always on", () => {
    expect(packageForModule("sales_orders")).toBeNull();
    expect(packageForModule("administration_users")).toBeNull();
    expect(packageForModule("crm")).toBe("CRM");
  });

  it("expands packages to their modules", () => {
    const mods = modulesOfPackages(new Set(["CRM", "HRMS"] as const));
    expect([...mods].sort()).toEqual(["crm", "crm_settings", "hrms_attendance", "hrms_leave"]);
  });
});
