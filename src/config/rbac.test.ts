import { describe, expect, it } from "vitest";
import { ACTIONS, MODULES, ROLE_PERMISSIONS } from "./rbac";

/**
 * Finished Goods Inventory module (2026-10-13, FGI-008). Confirms the new
 * `fg_inventory` module grants exactly the intended roles the intended
 * actions -- and, per the mandatory condition "do not grant access
 * automatically to unintended roles," confirms every OTHER role gets
 * nothing at all on this module, beyond the two pre-existing, intentional
 * blanket mechanisms (SUPER_ADMIN gets every module via its own wildcard;
 * VIEWER gets view-only on every module via its own wildcard) that every
 * other module in this file already relies on identically.
 */
describe("fg_inventory RBAC module (FGI-008)", () => {
  it("is present in the MODULES list", () => {
    expect(MODULES).toContain("fg_inventory");
  });

  it("every action granted anywhere on fg_inventory is a real, pre-existing action (no new verb invented)", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      const grant = ROLE_PERMISSIONS[role].fg_inventory;
      if (!grant) continue;
      for (const action of grant) {
        expect(ACTIONS).toContain(action);
      }
    }
  });

  it("SUPER_ADMIN gets every action on fg_inventory (via its own existing wildcard)", () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.fg_inventory).toEqual([...ACTIONS]);
  });

  it("VIEWER gets view-only on fg_inventory (via its own existing wildcard)", () => {
    expect(ROLE_PERMISSIONS.VIEWER.fg_inventory).toEqual(["view"]);
  });

  it("STORE_MANAGER gets full day-to-day ownership: view/create/edit/post/export/print, but not approve/delete/cancel/reject", () => {
    expect(ROLE_PERMISSIONS.STORE_MANAGER.fg_inventory).toEqual(["view", "create", "edit", "post", "export", "print"]);
  });

  it("WAREHOUSE_USER can raise/edit but not post or approve", () => {
    expect(ROLE_PERMISSIONS.WAREHOUSE_USER.fg_inventory).toEqual(["view", "create", "edit"]);
    expect(ROLE_PERMISSIONS.WAREHOUSE_USER.fg_inventory).not.toContain("post");
    expect(ROLE_PERMISSIONS.WAREHOUSE_USER.fg_inventory).not.toContain("approve");
  });

  it("DISPATCH_MANAGER gets view-only (their picking authority stays entirely under the existing dispatch module)", () => {
    expect(ROLE_PERMISSIONS.DISPATCH_MANAGER.fg_inventory).toEqual(["view"]);
  });

  it("MANAGEMENT gets the checkpoint shape: view/approve/export, never create/edit/post themselves", () => {
    expect(ROLE_PERMISSIONS.MANAGEMENT.fg_inventory).toEqual(["view", "approve", "export"]);
  });

  it("PRODUCTION_MANAGER and QC_MANAGER get view-only visibility", () => {
    expect(ROLE_PERMISSIONS.PRODUCTION_MANAGER.fg_inventory).toEqual(["view"]);
    expect(ROLE_PERMISSIONS.QC_MANAGER.fg_inventory).toEqual(["view"]);
  });

  it("does NOT grant fg_inventory automatically to roles with no stated reason to touch Finished Goods stock", () => {
    const unintendedRoles = [
      "MERCHANDISER",
      "SAMPLING_MANAGER",
      "PRODUCTION_SUPERVISOR",
      "PRODUCTION_WORKER",
      "EXTERNAL_UNIT_USER",
      "ACCOUNTS_MANAGER",
      "ACCOUNTS_EXECUTIVE",
    ] as const;
    for (const role of unintendedRoles) {
      expect(ROLE_PERMISSIONS[role].fg_inventory).toBeUndefined();
    }
  });

  it("picking has no permission of its own -- it stays reachable only through the existing dispatch module's own actions", () => {
    // A role whose ONLY fg_inventory grant is view-only (DISPATCH_MANAGER,
    // PRODUCTION_MANAGER, QC_MANAGER) must still be able to actually pick/
    // pack/confirm a dispatch -- that authority comes entirely from their
    // own, separate "dispatch" grant, never from fg_inventory.
    expect(ROLE_PERMISSIONS.DISPATCH_MANAGER.dispatch).toContain("post");
    expect(ROLE_PERMISSIONS.DISPATCH_MANAGER.fg_inventory).not.toContain("post");
  });

  it("reservation has no permission of its own anywhere -- confirmed by construction (no 'reserve' action exists in ACTIONS at all)", () => {
    expect(ACTIONS).not.toContain("reserve" as never);
  });
});
