import { describe, expect, it } from "vitest";
import type { Module } from "@/config/rbac";
import { isPathDisabled, isPathForbidden, modulesForPath } from "./route-modules";

describe("route → module mapping", () => {
  it("picks the most specific sidebar link", () => {
    expect(modulesForPath("/production/scan")).toEqual(["barcodes"]);
    expect(modulesForPath("/production/job-work/abc")).toEqual(["production"]);
  });

  it("returns null for a page no sidebar link covers", () => {
    expect(modulesForPath("/module-unavailable")).toBeNull();
  });

  it("does not treat a shared prefix as a match", () => {
    expect(modulesForPath("/barcodesx")).toBeNull();
  });

  it("disables a page only when every owning module is off", () => {
    const off = new Set<Module>(["barcodes"]);
    expect(isPathDisabled("/production/scan", off)).toBe(true);
    expect(isPathDisabled("/production/job-work", off)).toBe(false);
    expect(isPathDisabled("/production/scan", new Set())).toBe(false);
  });
});

describe("P6 -- page permission gate", () => {
  it("forbids a page when the user can view none of its modules", () => {
    expect(isPathForbidden("/accounts/journals", new Set<Module>(["production"]))).toBe(true);
    expect(isPathForbidden("/production/job-work", new Set<Module>(["production"]))).toBe(false);
  });

  it("never forbids a page no sidebar link covers", () => {
    expect(isPathForbidden("/no-access", new Set())).toBe(false);
    expect(isPathForbidden("/account", new Set())).toBe(false);
  });
});
