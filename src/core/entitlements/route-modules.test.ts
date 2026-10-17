import { describe, expect, it } from "vitest";
import type { Module } from "@/config/rbac";
import { isPathDisabled, modulesForPath } from "./route-modules";

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
