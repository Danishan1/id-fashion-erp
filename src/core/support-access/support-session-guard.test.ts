import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));

const {
  isSupportSessionLive,
  supportPermissionKeys,
  isMethodAllowedForSupport,
  SUPPORT_READ_ONLY_MODULES,
} = await import("./support-session-guard");

const future = new Date(Date.now() + 60_000);
const live = {
  revokedAt: null,
  endedAt: null,
  expiresAt: future,
  request: { status: "APPROVED" },
  company: { isActive: true },
  platformUser: { status: "ACTIVE" },
};

describe("isSupportSessionLive", () => {
  it("is live while approved, not revoked/ended/expired, company and operator active", () => {
    expect(isSupportSessionLive(live)).toBe(true);
  });

  it.each([
    ["revoked", { revokedAt: new Date() }],
    ["ended", { endedAt: new Date() }],
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ["request not approved", { request: { status: "PENDING" } }],
    ["company suspended", { company: { isActive: false } }],
    ["operator deactivated", { platformUser: { status: "SUSPENDED" } }],
  ])("is not live when %s", (_label, change) => {
    expect(isSupportSessionLive({ ...live, ...change })).toBe(false);
  });
});

describe("supportPermissionKeys", () => {
  it("read-only grants view/print but never create, edit, export, approve or delete", () => {
    const keys = supportPermissionKeys("READ_ONLY");
    expect(keys.has("sales_orders.view")).toBe(true);
    expect(keys.has("sales_orders.print")).toBe(true);
    for (const action of ["create", "edit", "export", "approve", "post", "delete", "cancel"]) {
      expect(keys.has(`sales_orders.${action}`)).toBe(false);
    }
  });

  it("read/write adds create/edit/cancel/scan but still never approve, post, delete or reject", () => {
    const keys = supportPermissionKeys("READ_WRITE");
    for (const action of ["create", "edit", "cancel"]) expect(keys.has(`sales_orders.${action}`)).toBe(true);
    for (const action of ["approve", "post", "delete", "reject", "override", "export"]) {
      expect(keys.has(`payments.${action}`)).toBe(false);
    }
  });

  it("administration modules stay read-only even in a write session", () => {
    const keys = supportPermissionKeys("READ_WRITE");
    for (const mod of SUPPORT_READ_ONLY_MODULES) {
      expect(keys.has(`${mod}.view`)).toBe(true);
      expect(keys.has(`${mod}.create`)).toBe(false);
      expect(keys.has(`${mod}.edit`)).toBe(false);
    }
  });
});

describe("isMethodAllowedForSupport", () => {
  it("allows reads in a read-only session", () => {
    expect(isMethodAllowedForSupport("READ_ONLY", "GET", "/api/v1/sales-orders")).toBe(true);
  });

  it("blocks every state-changing method in a read-only session", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isMethodAllowedForSupport("READ_ONLY", method, "/api/v1/sales-orders")).toBe(false);
    }
  });

  it("always allows the support session's own controls and sign-out", () => {
    expect(isMethodAllowedForSupport("READ_ONLY", "POST", "/api/v1/support-session/write-request")).toBe(true);
    expect(isMethodAllowedForSupport("READ_ONLY", "POST", "/api/auth/signout")).toBe(true);
  });

  it("allows writes once the customer approved write access", () => {
    expect(isMethodAllowedForSupport("READ_WRITE", "POST", "/api/v1/sales-orders")).toBe(true);
  });
});
