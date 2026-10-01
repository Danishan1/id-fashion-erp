import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

const { requireSessionMock, assertMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn(), assertMock: vi.fn() }));

// The real api-route pulls in next-auth; keep the real error mapping but stub the session.
vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: requireSessionMock,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: assertMock } }));

const { crmRoute } = await import("./crm-route");

const req = {} as never;
const session = { user: { id: "user-1", companyId: "co-1", defaultBranchId: "br-1" } };

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(session);
  assertMock.mockReset().mockResolvedValue(undefined);
});

describe("crmRoute", () => {
  it("checks crm.<action> and hands the handler an actor built from the session", async () => {
    const handler = vi.fn(async ({ actor, params }) => Response.json({ actor, params }));
    const res = await crmRoute<{ id: string }>("edit", handler)(req, { params: Promise.resolve({ id: "x1" }) });

    expect(assertMock).toHaveBeenCalledWith("user-1", "crm", "edit");
    expect(await res.json()).toEqual({ actor: { companyId: "co-1", userId: "user-1", branchId: "br-1" }, params: { id: "x1" } });
  });

  it("can check a CRM settings permission instead", async () => {
    await crmRoute({ module: "crm_settings", action: "edit" }, async () => Response.json({}))(req, { params: Promise.resolve({}) });
    expect(assertMock).toHaveBeenCalledWith("user-1", "crm_settings", "edit");
  });

  it("maps a missing session / denied permission to the standard error response without calling the handler", async () => {
    const handler = vi.fn();
    assertMock.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "No access."));
    const res = await crmRoute("view", handler)(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ error: { code: "PERMISSION_DENIED", message: "No access." } });
  });

  it("maps a business rule error thrown by the handler", async () => {
    const res = await crmRoute("view", async () => {
      throw new BusinessRuleError("NOT_FOUND", "CRM event not found.");
    })(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
  });
});
