import { describe, expect, it } from "vitest";
import { MODULES, ROLE_PERMISSIONS } from "@/config/rbac";
import { ENTITLEMENT_PACKAGES, packageForModule } from "@/config/module-entitlements";
import { moduleLabel } from "@/config/permission-groups";
import { NAV_SECTIONS, filterNavSections } from "@/components/layout/navigation";
import { modulesForPath } from "@/core/entitlements/route-modules";

describe("Sales & Marketing module wiring", () => {
  it("replaces the old marketing module", () => {
    expect(MODULES).toContain("sales_marketing");
    expect(MODULES as readonly string[]).not.toContain("marketing");
    expect(ENTITLEMENT_PACKAGES.map((p) => p.key)).not.toContain("MARKETING");
    expect(packageForModule("sales_marketing")).toBe("SALES_MARKETING");
    expect(moduleLabel("sales_marketing")).toBe("Sales & Marketing");
  });

  it("gives Sales & Marketing to exactly the built-in roles that have CRM, with the same actions", () => {
    for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "SUPER_ADMIN" || role === "VIEWER") continue;
      expect(grants.sales_marketing, role).toEqual(grants.crm);
    }
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.sales_marketing).toContain("view");
    expect(ROLE_PERMISSIONS.VIEWER.sales_marketing).toEqual(["view"]);
  });

  it("owns its pages for route protection and module entitlements", () => {
    expect(modulesForPath("/sales-marketing")).toEqual(["sales_marketing", "sales_quotations", "sales_marketing_settings", "sales_pricing", "sales_performance", "sales_commissions", "marketing_campaigns", "marketing_segments", "marketing_delivery", "marketing_content", "marketing_promotions", "marketing_attribution", "sales_workflows", "sales_integrations", "sales_analytics"]);
    expect(modulesForPath("/sales-marketing/commissions/plans/x")).toEqual(["sales_commissions"]);
    expect(modulesForPath("/sales-marketing/campaigns/calendar")).toEqual(["marketing_campaigns"]);
    expect(modulesForPath("/sales-marketing/segments/x")).toEqual(["marketing_segments"]);
    expect(modulesForPath("/sales-marketing/delivery/runs/x")).toEqual(["marketing_delivery"]);
    expect(modulesForPath("/sales-marketing/content/assets/x")).toEqual(["marketing_content"]);
    expect(modulesForPath("/sales-marketing/promotions/x")).toEqual(["marketing_promotions"]);
    expect(modulesForPath("/sales-marketing/budgets")).toEqual(["marketing_campaigns"]);
    expect(modulesForPath("/sales-marketing/attribution/models/x")).toEqual(["marketing_attribution"]);
    expect(modulesForPath("/sales-marketing/delivery/connections")).toEqual(["sales_marketing_settings"]);
    expect(modulesForPath("/sales-marketing/targets/x")).toEqual(["sales_performance"]);
    expect(modulesForPath("/sales-marketing/pricing/discounts/x")).toEqual(["sales_pricing"]);
    expect(modulesForPath("/sales-marketing/enquiries/x")).toEqual(["sales_marketing"]);
    expect(modulesForPath("/sales-marketing/quotations/x")).toEqual(["sales_quotations"]);
    expect(modulesForPath("/marketing")).toBeNull();
    expect(modulesForPath("/campaigns")).toBeNull();
  });

  it("shows the sidebar group only to users who can view the module", () => {
    const section = NAV_SECTIONS.find((s) => s.label === "Sales & Marketing");
    expect(section?.href).toBe("/sales-marketing");
    const withAccess = filterNavSections(NAV_SECTIONS, ["sales_marketing"]);
    expect(withAccess.map((s) => s.label)).toContain("Sales & Marketing");
    const without = filterNavSections(NAV_SECTIONS, ["crm"]);
    expect(without.map((s) => s.label)).not.toContain("Sales & Marketing");
  });
});
