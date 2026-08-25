import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn(), advanceMasterCodeSequence: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    crmActivity: { create: vi.fn() },
    crmFollowup: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("./deal.repository", () => ({
  DealRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    salesLeaderboard: vi.fn(),
  },
}));
vi.mock("./lead.repository", () => ({
  LeadRepository: { findAnyById: vi.fn() },
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("@/modules/production-config/production-config.repository", () => ({
  ProductionConfigRepository: { salesAgent: { findFirst: vi.fn() } },
}));

const { prisma } = await import("@/core/db/client");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { DealRepository } = await import("./deal.repository");
const { LeadRepository } = await import("./lead.repository");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { ProductionConfigRepository } = await import("@/modules/production-config/production-config.repository");
const { computeWeightedValue, createDeal, changeDealStage, updateDeal, getSalesLeaderboard } = await import("./deal.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("DEAL-2026-00001");
  vi.mocked(DealRepository.create).mockReset();
  vi.mocked(DealRepository.update).mockReset();
  vi.mocked(DealRepository.findAnyById).mockReset();
  vi.mocked(DealRepository.salesLeaderboard).mockReset();
  vi.mocked(prisma.crmActivity.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(prisma.user.findFirst).mockReset().mockResolvedValue({ id: "user-2" } as never);
  vi.mocked(LeadRepository.findAnyById).mockReset().mockResolvedValue({ id: "lead-1" } as never);
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset().mockResolvedValue({ id: "cust-1", buyers: [] } as never);
  vi.mocked(ProductionConfigRepository.salesAgent.findFirst).mockReset().mockResolvedValue({ id: "agent-1" } as never);
});

describe("computeWeightedValue", () => {
  it("matches the source's own display-time formula exactly", () => {
    expect(computeWeightedValue(10000, 40)).toBe(4000);
    expect(computeWeightedValue(0, 100)).toBe(0);
    expect(computeWeightedValue(5000, 0)).toBe(0);
  });
});

describe("createDeal", () => {
  it("generates a deal number and defaults stage to QUALIFIED", async () => {
    vi.mocked(DealRepository.create).mockResolvedValue({ id: "deal-new", value: "1000", probabilityPercent: "20" } as never);

    await createDeal(actor, { title: "New Deal", value: 1000, probabilityPercent: 20 } as never);

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ documentType: "DEAL" }));
    expect(DealRepository.create).toHaveBeenCalledWith(expect.objectContaining({ dealNumber: "DEAL-2026-00001", title: "New Deal" }));
  });

  // leadId/customerId/salesAgentId/assignedToUserId were previously written
  // straight from client input with zero ownership check — a direct API
  // call with another tenant's id would succeed and embed that tenant's
  // full record in every subsequent read (confirmed cross-tenant
  // disclosure, fixed). These four tests reproduce that exact class of bug
  // and confirm it's now rejected.
  it("rejects a leadId belonging to another company", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(null);
    await expect(
      createDeal(actor, { title: "New Deal", value: 1000, probabilityPercent: 20, leadId: "lead-x" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(DealRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a customerId belonging to another company", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);
    await expect(
      createDeal(actor, { title: "New Deal", value: 1000, probabilityPercent: 20, customerId: "cust-x" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(DealRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a salesAgentId belonging to another company", async () => {
    vi.mocked(ProductionConfigRepository.salesAgent.findFirst).mockResolvedValue(null);
    await expect(
      createDeal(actor, { title: "New Deal", value: 1000, probabilityPercent: 20, salesAgentId: "agent-x" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(DealRepository.create).not.toHaveBeenCalled();
  });

  it("rejects an assignedToUserId belonging to another company", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    await expect(
      createDeal(actor, { title: "New Deal", value: 1000, probabilityPercent: 20, assignedToUserId: "user-x" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(DealRepository.create).not.toHaveBeenCalled();
  });

  it("succeeds when every referenced id belongs to this company", async () => {
    vi.mocked(DealRepository.create).mockResolvedValue({ id: "deal-new", value: "1000", probabilityPercent: "20" } as never);

    await createDeal(actor, {
      title: "New Deal",
      value: 1000,
      probabilityPercent: 20,
      leadId: "lead-1",
      customerId: "cust-1",
      salesAgentId: "agent-1",
      assignedToUserId: "user-2",
    } as never);

    expect(DealRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-1", customerId: "cust-1", salesAgentId: "agent-1", assignedToUserId: "user-2" })
    );
  });
});

describe("changeDealStage", () => {
  it("allows forward progression QUALIFIED -> PROPOSAL", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "QUALIFIED", probabilityPercent: "20" } as never);
    vi.mocked(DealRepository.update).mockResolvedValue({ id: "deal-1", value: "0", probabilityPercent: "20" } as never);

    await changeDealStage(actor, "deal-1", { stage: "PROPOSAL" } as never);

    expect(DealRepository.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ stage: "PROPOSAL" }));
  });

  it("rejects an illegal jump, e.g. QUALIFIED straight to WON", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "QUALIFIED" } as never);

    await expect(changeDealStage(actor, "deal-1", { stage: "WON" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(DealRepository.update).not.toHaveBeenCalled();
  });

  it("rejects any transition out of a terminal WON stage", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "WON" } as never);

    await expect(changeDealStage(actor, "deal-1", { stage: "LOST" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("sets probability to 100 on WON and 0 on LOST", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "NEGOTIATION", probabilityPercent: "60" } as never);
    vi.mocked(DealRepository.update).mockResolvedValue({ id: "deal-1", value: "0", probabilityPercent: "100" } as never);

    await changeDealStage(actor, "deal-1", { stage: "WON" } as never);

    expect(DealRepository.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ probabilityPercent: 100 }));
  });

  it("requires a lostReason when marking LOST — schema-level, but service still stores it", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "PROPOSAL", probabilityPercent: "40" } as never);
    vi.mocked(DealRepository.update).mockResolvedValue({ id: "deal-1", value: "0", probabilityPercent: "0" } as never);

    await changeDealStage(actor, "deal-1", { stage: "LOST", lostReason: "Budget cut" } as never);

    expect(DealRepository.update).toHaveBeenCalledWith("deal-1", expect.objectContaining({ stage: "LOST", lostReason: "Budget cut", probabilityPercent: 0 }));
  });

  it("leaves an activity-timeline entry for every stage move, whether from the detail page or the pipeline board", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "QUALIFIED", probabilityPercent: "20" } as never);
    vi.mocked(DealRepository.update).mockResolvedValue({ id: "deal-1", value: "0", probabilityPercent: "20" } as never);

    await changeDealStage(actor, "deal-1", { stage: "PROPOSAL" } as never);

    expect(prisma.crmActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relatedModule: "DEAL", relatedRecordId: "deal-1", subject: "Stage changed: QUALIFIED → PROPOSAL" }),
      })
    );
  });
});

describe("updateDeal", () => {
  it("blocks editing a deal that's already WON", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "WON" } as never);

    await expect(updateDeal(actor, "deal-1", { title: "New title" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(DealRepository.update).not.toHaveBeenCalled();
  });

  it("blocks editing a deal that's already LOST", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "LOST" } as never);

    await expect(updateDeal(actor, "deal-1", { title: "New title" } as never)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("allows editing a still-open deal", async () => {
    vi.mocked(DealRepository.findAnyById).mockResolvedValue({ id: "deal-1", stage: "QUALIFIED" } as never);
    vi.mocked(DealRepository.update).mockResolvedValue({ id: "deal-1", value: "0", probabilityPercent: "0" } as never);

    await updateDeal(actor, "deal-1", { title: "New title" } as never);

    expect(DealRepository.update).toHaveBeenCalled();
  });
});

describe("getSalesLeaderboard", () => {
  it("sums open pipeline separately from won revenue, per salesperson, mirroring the source exactly", async () => {
    vi.mocked(DealRepository.salesLeaderboard).mockResolvedValue([
      {
        id: "user-a",
        fullName: "Alice",
        leadsAssigned: [{ id: "lead-1" }, { id: "lead-2" }],
        dealsAssigned: [
          { value: "1000", stage: "QUALIFIED" },
          { value: "5000", stage: "WON" },
          { value: "2000", stage: "LOST" },
        ],
      },
    ] as never);

    const result = await getSalesLeaderboard("co-1");

    expect(result).toEqual([{ userId: "user-a", fullName: "Alice", leadCount: 2, pipeline: 1000, wonValue: 5000 }]);
  });
});
