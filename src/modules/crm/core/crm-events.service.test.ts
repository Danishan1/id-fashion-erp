import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/logging/requestContext", () => ({ getRequestContext: vi.fn(() => ({ requestId: "req-123" })) }));
vi.mock("./crm-event.repository", () => ({
  CrmEventRepository: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findById: vi.fn() },
}));

const { CrmEventRepository } = await import("./crm-event.repository");
const { buildCrmEventData, buildCrmEventWhere, getCrmEventById, listCrmEvents, recordCrmEvent } = await import("./crm-events.service");

const ID = "6f1c2f1e-1f2a-4b1a-9d1a-2b3c4d5e6f70";
const actor = { companyId: "co-1", userId: "user-1", branchId: null };
const query = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "occurredAt", sortOrder: "desc" as const };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    entityType: "LEAD",
    entityId: ID,
    eventType: "lead.created",
    summary: "Acme",
    payload: null,
    correlationId: "req-123",
    occurredAt: new Date("2026-10-01T05:00:00Z"),
    actor: { id: "user-1", fullName: "Admin" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(CrmEventRepository.create).mockReset().mockResolvedValue(row() as never);
  vi.mocked(CrmEventRepository.findMany).mockReset().mockResolvedValue([row()] as never);
  vi.mocked(CrmEventRepository.count).mockReset().mockResolvedValue(1);
  vi.mocked(CrmEventRepository.findById).mockReset();
});

describe("buildCrmEventData", () => {
  it("takes company and actor from the actor, and attaches the request correlation id", () => {
    const data = buildCrmEventData(actor, { entityType: "LEAD", entityId: ID, eventType: "lead.created", summary: "  Acme  " });
    expect(data).toMatchObject({ companyId: "co-1", actorUserId: "user-1", eventType: "lead.created", summary: "Acme", correlationId: "req-123" });
  });

  it("throws on an unregistered event type", () => {
    expect(() => buildCrmEventData(actor, { entityType: "LEAD", entityId: ID, eventType: "lead.vanished" as never })).toThrow();
  });
});

describe("recordCrmEvent", () => {
  it("passes the given transaction client through to the repository", async () => {
    const tx = { crmEvent: {} };
    await recordCrmEvent(actor, { entityType: "LEAD", entityId: ID, eventType: "lead.updated" }, tx as never);
    expect(CrmEventRepository.create).toHaveBeenCalledWith(expect.objectContaining({ eventType: "lead.updated" }), tx);
  });
});

describe("buildCrmEventWhere", () => {
  it("always scopes by company", () => {
    expect(buildCrmEventWhere("co-1", {})).toEqual({ companyId: "co-1" });
  });

  it("maps every filter, with an inclusive whole-day date range", () => {
    const where = buildCrmEventWhere(
      "co-1",
      { entityType: "LEAD", entityId: ID, eventType: "lead.created", actorUserId: "u-2", from: "2026-10-01", to: "2026-10-02" },
      "acme"
    );
    expect(where).toMatchObject({ companyId: "co-1", entityType: "LEAD", entityId: ID, eventType: "lead.created", actorUserId: "u-2" });
    expect(where.occurredAt).toEqual({ gte: new Date("2026-10-01T00:00:00.000Z"), lte: new Date("2026-10-02T23:59:59.999Z") });
    expect(where.OR).toHaveLength(2);
  });
});

describe("listCrmEvents", () => {
  it("returns presented rows with labels and the total", async () => {
    const result = await listCrmEvents("co-1", {}, query);
    expect(result.totalCount).toBe(1);
    expect(result.data[0]).toMatchObject({ label: "Lead created", category: "created", entityLabel: "Lead", entityHref: null });
    expect(CrmEventRepository.findMany).toHaveBeenCalledWith({ companyId: "co-1" }, 0, 20, "desc");
  });
});

describe("getCrmEventById", () => {
  it("looks up within the caller's company only and 404s otherwise", async () => {
    vi.mocked(CrmEventRepository.findById).mockResolvedValue(null);
    await expect(getCrmEventById("co-1", "ev-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(CrmEventRepository.findById).toHaveBeenCalledWith("co-1", "ev-x");
  });
});
