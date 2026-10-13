import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createBulkJob: vi.fn(),
  listBulkJobs: vi.fn(),
  getBulkJob: vi.fn(),
  listBulkJobItems: vi.fn(),
  cancelBulkJob: vi.fn(),
  retryBulkJob: vi.fn(),
  buildBulkErrorReport: vi.fn(),
  downloadBulkExport: vi.fn(),
}));

vi.mock("@/lib/api-route", async () => {
  const { toErrorResponse } = await import("@/core/errors/BusinessRuleError");
  return {
    requireSession: m.requireSession,
    handleApiError: (error: unknown) => {
      const { status, body } = toErrorResponse(error);
      return Response.json(body, { status });
    },
  };
});
vi.mock("@/modules/bulk-actions/bulk-jobs.service", () => m);

const list = await import("./route");
const one = await import("./[...path]/route");
const ID = "6b0f5a8e-2b4c-4d7e-9f10-1a2b3c4d5e6f";
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, "http://localhost"), init as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ user: { id: "u1", companyId: "c1", defaultBranchId: null } });
});

describe("/api/v1/bulk-jobs", () => {
  it("needs a session", async () => {
    const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
    m.requireSession.mockRejectedValue(new BusinessRuleError("PERMISSION_DENIED", "Sign in required."));
    const res = await list.GET(req("/api/v1/bulk-jobs"), ctx([]) as never);
    expect(res.status).toBe(403);
    expect(m.listBulkJobs).not.toHaveBeenCalled();
  });

  it("POST returns 202 for a new job, 200 for a duplicate submit; actor comes from the session only", async () => {
    m.createBulkJob.mockResolvedValueOnce({ id: "j1", duplicate: false }).mockResolvedValueOnce({ id: "j1", duplicate: true });
    const body = JSON.stringify({ entityType: "LEAD", actionKey: "lead.assign", selection: { mode: "IDS", ids: [ID] }, params: {}, userId: "attacker" });
    expect((await list.POST(req("/api/v1/bulk-jobs", { method: "POST", body }), ctx([]) as never)).status).toBe(202);
    expect((await list.POST(req("/api/v1/bulk-jobs", { method: "POST", body }), ctx([]) as never)).status).toBe(200);
    expect(m.createBulkJob.mock.calls[0][0]).toEqual({ companyId: "c1", userId: "u1", branchId: null });
  });

  it("rejects malformed JSON with a validation error", async () => {
    const res = await list.POST(req("/api/v1/bulk-jobs", { method: "POST", body: "{nope" }), ctx([]) as never);
    expect(res.status).toBe(400);
  });

  it("catch-all: unknown endpoints and non-uuid ids are 404; cancel / retry / items route correctly", async () => {
    expect((await one.GET(req(`/api/v1/bulk-jobs/${ID}/secrets`), ctx([ID, "secrets"]) as never)).status).toBe(404);
    expect((await one.GET(req("/api/v1/bulk-jobs/../etc"), ctx(["..", "etc"]) as never)).status).toBe(404);
    expect((await one.POST(req(`/api/v1/bulk-jobs/${ID}/run`, { method: "POST" }), ctx([ID, "run"]) as never)).status).toBe(404);
    m.cancelBulkJob.mockResolvedValue({ id: ID, status: "CANCEL_REQUESTED" });
    expect((await one.POST(req(`/api/v1/bulk-jobs/${ID}/cancel`, { method: "POST" }), ctx([ID, "cancel"]) as never)).status).toBe(200);
    m.retryBulkJob.mockResolvedValue({ id: "j2", duplicate: false });
    expect((await one.POST(req(`/api/v1/bulk-jobs/${ID}/retry`, { method: "POST", body: "{}" }), ctx([ID, "retry"]) as never)).status).toBe(202);
    m.listBulkJobItems.mockResolvedValue({ data: [], totalCount: 0 });
    const items = await one.GET(req(`/api/v1/bulk-jobs/${ID}/items?statuses=FAILED`), ctx([ID, "items"]) as never);
    expect(items.status).toBe(200);
    expect(m.listBulkJobItems.mock.calls[0][2]).toEqual({ statuses: ["FAILED"] });
  });

  it("downloads are attachments that are never cached", async () => {
    m.downloadBulkExport.mockResolvedValue({ fileName: "leads export.csv", mimeType: "text/csv", buffer: Buffer.from("a,b") });
    const res = await one.GET(req(`/api/v1/bulk-jobs/${ID}/download`), ctx([ID, "download"]) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="leads_export.csv"');
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
