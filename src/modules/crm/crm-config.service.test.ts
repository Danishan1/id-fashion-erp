import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    crmPipelineStage: { count: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    crmLeadSource: { count: vi.fn(), createMany: vi.fn() },
    crmLostReason: { count: vi.fn(), createMany: vi.fn() },
    lead: { count: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { ensureCrmDefaults, getEntryStage, updatePipelineStage } = await import("./crm-config.service");

const actor = { companyId: "co-1", userId: "user-1" };
const stage = { id: "st-1", companyId: "co-1", pipeline: "LEAD", code: "CONTACTED", name: "Contacted", kind: "OPEN", sortOrder: 30, isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.crmPipelineStage.count).mockResolvedValue(12 as never);
  vi.mocked(prisma.crmLeadSource.count).mockResolvedValue(22 as never);
  vi.mocked(prisma.crmLostReason.count).mockResolvedValue(13 as never);
});

describe("ensureCrmDefaults", () => {
  it("seeds only the lists that are completely empty", async () => {
    vi.mocked(prisma.crmLeadSource.count).mockResolvedValue(0 as never);

    await ensureCrmDefaults("co-1");

    expect(prisma.crmLeadSource.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.crmPipelineStage.createMany).not.toHaveBeenCalled();
    expect(prisma.crmLostReason.createMany).not.toHaveBeenCalled();
  });
});

describe("getEntryStage", () => {
  it("prefers NEW_LEAD, else the first active OPEN stage", async () => {
    vi.mocked(prisma.crmPipelineStage.findMany).mockResolvedValue([
      { id: "a", code: "CONTACTED", kind: "OPEN" },
      { id: "b", code: "NEW_LEAD", kind: "OPEN" },
    ] as never);
    expect((await getEntryStage("co-1")).id).toBe("b");

    vi.mocked(prisma.crmPipelineStage.findMany).mockResolvedValue([
      { id: "w", code: "WON", kind: "WON" },
      { id: "a", code: "CONTACTED", kind: "OPEN" },
    ] as never);
    expect((await getEntryStage("co-1")).id).toBe("a");
  });

  it("throws when no active open stage exists", async () => {
    vi.mocked(prisma.crmPipelineStage.findMany).mockResolvedValue([{ id: "w", code: "WON", kind: "WON" }] as never);
    await expect(getEntryStage("co-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("updatePipelineStage", () => {
  const input = { code: "CONTACTED", name: "Contacted", sortOrder: 30, kind: "OPEN" as const };

  it("blocks deactivating a stage that still holds leads", async () => {
    vi.mocked(prisma.crmPipelineStage.findFirst).mockResolvedValue(stage as never);
    vi.mocked(prisma.lead.count).mockResolvedValue(3 as never);

    await expect(updatePipelineStage(actor, "st-1", { ...input, isActive: false })).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
    expect(prisma.crmPipelineStage.update).not.toHaveBeenCalled();
  });

  it("blocks changing the type of a stage that still holds leads", async () => {
    vi.mocked(prisma.crmPipelineStage.findFirst).mockResolvedValue(stage as never);
    vi.mocked(prisma.lead.count).mockResolvedValue(1 as never);

    await expect(updatePipelineStage(actor, "st-1", { ...input, kind: "LOST" })).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });

  it("blocks a change that would leave no active WON stage", async () => {
    vi.mocked(prisma.crmPipelineStage.findFirst).mockResolvedValue({ ...stage, kind: "WON" } as never);
    vi.mocked(prisma.lead.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.crmPipelineStage.findMany).mockResolvedValue([{ kind: "OPEN" }, { kind: "LOST" }] as never);

    await expect(updatePipelineStage(actor, "st-1", { ...input, kind: "WON", isActive: false })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("allows a plain rename without touching lead counts", async () => {
    vi.mocked(prisma.crmPipelineStage.findFirst).mockResolvedValue(stage as never);
    vi.mocked(prisma.crmPipelineStage.update).mockResolvedValue({ ...stage, name: "Reached" } as never);

    await updatePipelineStage(actor, "st-1", { ...input, name: "Reached" });

    expect(prisma.lead.count).not.toHaveBeenCalled();
    expect(prisma.crmPipelineStage.update).toHaveBeenCalledWith({ where: { id: "st-1" }, data: expect.objectContaining({ name: "Reached", isActive: true }) });
  });

  it("returns NOT_FOUND for another company's stage", async () => {
    vi.mocked(prisma.crmPipelineStage.findFirst).mockResolvedValue(null);
    await expect(updatePipelineStage(actor, "st-foreign", input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
