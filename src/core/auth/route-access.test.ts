import { describe, expect, it } from "vitest";
import { decideRouteAccess, isPlatformPath } from "./route-access";

describe("isPlatformPath", () => {
  it("matches /platform and anything under it, but not look-alike paths", () => {
    expect(isPlatformPath("/platform")).toBe(true);
    expect(isPlatformPath("/platform/companies")).toBe(true);
    expect(isPlatformPath("/platforms")).toBe(false);
    expect(isPlatformPath("/dashboard")).toBe(false);
  });
});

describe("decideRouteAccess — signed out", () => {
  it("allows both login pages", () => {
    expect(decideRouteAccess("/login", false, undefined)).toEqual({ kind: "allow" });
    expect(decideRouteAccess("/platform/login", false, undefined)).toEqual({ kind: "allow" });
  });

  it("sends platform pages to the platform login, keeping where they were going", () => {
    expect(decideRouteAccess("/platform/companies", false, undefined)).toEqual({
      kind: "redirect",
      to: "/platform/login?callbackUrl=%2Fplatform%2Fcompanies",
    });
  });

  it("sends customer ERP pages to the normal tenant login", () => {
    expect(decideRouteAccess("/dashboard", false, undefined)).toEqual({ kind: "require-tenant-login" });
  });
});

describe("decideRouteAccess — platform operator (PLAT-003/004)", () => {
  it("can use the platform portal", () => {
    expect(decideRouteAccess("/platform", true, "PLATFORM")).toEqual({ kind: "allow" });
    expect(decideRouteAccess("/platform/companies/new", true, "PLATFORM")).toEqual({ kind: "allow" });
  });

  it("is sent back to the portal from every customer ERP page", () => {
    for (const path of ["/dashboard", "/sales-orders", "/accounts/journals", "/admin", "/"]) {
      expect(decideRouteAccess(path, true, "PLATFORM")).toEqual({ kind: "redirect", to: "/platform" });
    }
  });

  it("is sent to the portal home from either login page", () => {
    expect(decideRouteAccess("/platform/login", true, "PLATFORM")).toEqual({ kind: "redirect", to: "/platform" });
    expect(decideRouteAccess("/login", true, "PLATFORM")).toEqual({ kind: "redirect", to: "/platform" });
  });
});

describe("decideRouteAccess — customer (tenant) user", () => {
  it("can use the ERP", () => {
    expect(decideRouteAccess("/dashboard", true, "TENANT")).toEqual({ kind: "allow" });
  });

  it("is kept out of every platform page, including for a pre-Phase-1 session with no userType", () => {
    for (const userType of ["TENANT", undefined] as const) {
      expect(decideRouteAccess("/platform", true, userType)).toEqual({ kind: "redirect", to: "/dashboard" });
      expect(decideRouteAccess("/platform/companies", true, userType)).toEqual({ kind: "redirect", to: "/dashboard" });
    }
  });

  it("may open the platform login page (to sign in as an operator instead)", () => {
    expect(decideRouteAccess("/platform/login", true, "TENANT")).toEqual({ kind: "allow" });
  });

  it("is sent to the dashboard from the tenant login page", () => {
    expect(decideRouteAccess("/login", true, "TENANT")).toEqual({ kind: "redirect", to: "/dashboard" });
  });
});

describe("decideRouteAccess — support session (Phase 2)", () => {
  it("may use ERP pages", () => {
    expect(decideRouteAccess("/sales-orders", true, "SUPPORT")).toEqual({ kind: "allow" });
  });

  it("never reaches the platform portal", () => {
    expect(decideRouteAccess("/platform/companies", true, "SUPPORT")).toEqual({ kind: "redirect", to: "/dashboard" });
  });

  it("can always reach the support-ended page, signed in or out", () => {
    expect(decideRouteAccess("/support-ended", true, "SUPPORT")).toEqual({ kind: "allow" });
    expect(decideRouteAccess("/support-ended", false, undefined)).toEqual({ kind: "allow" });
  });
});
