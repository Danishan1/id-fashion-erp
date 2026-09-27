import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("./crm-settings.service", () => ({
  getCrmSettings: vi.fn().mockResolvedValue({ hotThreshold: 80, warmThreshold: 50 }),
  DEFAULT_LEAD_PRIORITY_THRESHOLDS: { hotThreshold: 80, warmThreshold: 50 },
}));
vi.mock("./crm-config.service", () => ({
  ensureCrmDefaults: vi.fn(),
  getEntryStage: vi.fn(),
  getStageForCompany: vi.fn(),
}));

// One shared transaction client — prisma.$transaction(fn) just runs fn(tx).
const tx = vi.hoisted(() => ({
  lead: { create: vi.fn(), update: vi.fn() },
  crmStageHistory: { create: vi.fn() },
  crmAssignmentHistory: { create: vi.fn() },
  crmFollowup: { create: vi.fn() },
  crmActivity: { create: vi.fn() },
  crmLeadProductInterest: { deleteMany: vi.fn(), createMany: vi.fn() },
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    crmLeadSource: { findFirst: vi.fn() },
    crmLostReason: { findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    season: { findFirst: vi.fn() },
    campaign: { findFirst: vi.fn() },
    productType: { count: vi.fn() },
  },
}));
vi.mock("./lead.repository", () => ({
  LeadRepository: {
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findDuplicates: vi.fn(),
  },
  CrmRoundRobinRepository: {
    findOrCreate: vi.fn(),
    updateLastAssigned: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { LeadRepository, CrmRoundRobinRepository } = await import("./lead.repository");
const { getEntryStage, getStageForCompany } = await import("./crm-config.service");
const { computeLeadQuality, createLead, updateLead, changeLeadStage } = await import("./lead.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const DETAIL = { id: "lead-new", leadScore: "0", createdAt: new Date(), stageChangedAt: new Date(), lastActivityAt: null };

const STAGES = {
  NEW: { id: "st-new", companyId: "co-1", pipeline: "LEAD", name: "New Lead", kind: "OPEN", isActive: true },
  CONTACTED: { id: "st-contacted", companyId: "co-1", pipeline: "LEAD", name: "Contacted", kind: "OPEN", isActive: true },
  LOST: { id: "st-lost", companyId: "co-1", pipeline: "LEAD", name: "Lost", kind: "LOST", isActive: true },
  WON: { id: "st-won", companyId: "co-1", pipeline: "LEAD", name: "Won", kind: "WON", isActive: true },
  INACTIVE: { id: "st-old", companyId: "co-1", pipeline: "LEAD", name: "Old", kind: "OPEN", isActive: false },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateDocumentNumber).mockResolvedValue("LEAD-2026-00001");
  vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([]);
  vi.mocked(LeadRepository.findByIdWithDetails).mockResolvedValue(DETAIL as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "user-explicit" } as never);
  vi.mocked(prisma.crmLeadSource.findFirst).mockResolvedValue({ id: "src-other" } as never);
  vi.mocked(getEntryStage).mockResolvedValue(STAGES.NEW as never);
  vi.mocked(getStageForCompany).mockImplementation(async (_c: string, id: string) => {
    const s = Object.values(STAGES).find((x) => x.id === id);
    if (!s) throw new Error("not found");
    return s as never;
  });
  tx.lead.create.mockResolvedValue({ id: "lead-new" });
});

describe("computeLeadQuality", () => {
  it("is HOT at exactly the 80 threshold and above", () => {
    expect(computeLeadQuality(80)).toBe("HOT");
    expect(computeLeadQuality(95)).toBe("HOT");
  });

  it("is WARM at exactly the 50 threshold, below 80", () => {
    expect(computeLeadQuality(50)).toBe("WARM");
    expect(computeLeadQuality(79.9)).toBe("WARM");
  });

  it("is COLD below 50", () => {
    expect(computeLeadQuality(0)).toBe("COLD");
    expect(computeLeadQuality(49.9)).toBe("COLD");
  });

  it("handles a Decimal-shaped string the same as a number", () => {
    expect(computeLeadQuality("80.00")).toBe("HOT");
  });

  it("uses a custom threshold pair when one is supplied", () => {
    const custom = { hotThreshold: 90, warmThreshold: 60 };
    expect(computeLeadQuality(85, custom)).toBe("WARM");
    expect(computeLeadQuality(55, custom)).toBe("COLD");
    expect(computeLeadQuality(90, custom)).toBe("HOT");
  });
});

describe("createLead", () => {
  it("rejects when a possible duplicate already exists", async () => {
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);

    await expect(createLead(actor, { name: "New Lead", email: "a@b.com" } as never)).rejects.toMatchObject({ code: "DUPLICATE_LEAD_EXISTS" });
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("checks mobile, WhatsApp and alternative phone against every phone field, and company+country", async () => {
    await createLead(actor, {
      name: "New Lead",
      phone: "+919800000001",
      whatsappNumber: "+919800000002",
      alternativePhone: "+919800000001",
      companyName: "ABC Fashion",
      country: "India",
    } as never);

    expect(LeadRepository.findDuplicates).toHaveBeenCalledWith(
      "co-1",
      { email: null, phones: ["+919800000001", "+919800000002"], companyName: "ABC Fashion", country: "India" },
      undefined
    );
  });

  it("succeeds despite a duplicate when overrideDuplicateCheck is set", async () => {
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);

    await createLead(actor, { name: "New Lead", email: "a@b.com", overrideDuplicateCheck: true } as never);

    expect(tx.lead.create).toHaveBeenCalled();
    expect(LeadRepository.findDuplicates).not.toHaveBeenCalled();
  });

  it("places a new lead in the entry stage and records the first stage history row", async () => {
    await createLead(actor, { name: "New Lead", assignedToUserId: "user-explicit" } as never);

    expect(tx.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stageId: "st-new", sourceId: "src-other" }) });
    expect(tx.crmStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ relatedModule: "LEAD", fromStageId: null, toStageId: "st-new", changedByUserId: "user-1" }),
    });
  });

  it("auto-assigns via round-robin and records it in assignment history", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-a" }, { id: "user-b" }, { id: "user-c" }] as never);
    vi.mocked(CrmRoundRobinRepository.findOrCreate).mockResolvedValue({ companyId: "co-1", lastAssignedUserId: "user-a" } as never);

    await createLead(actor, { name: "New Lead" } as never);

    expect(CrmRoundRobinRepository.updateLastAssigned).toHaveBeenCalledWith("co-1", "user-b");
    expect(tx.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedToUserId: "user-b" }) });
    expect(tx.crmAssignmentHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromUserId: null, toUserId: "user-b", reason: "Auto-assigned (round robin)" }),
    });
  });

  it("wraps back to the first user once the last one has been assigned", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-a" }, { id: "user-b" }] as never);
    vi.mocked(CrmRoundRobinRepository.findOrCreate).mockResolvedValue({ companyId: "co-1", lastAssignedUserId: "user-b" } as never);

    await createLead(actor, { name: "New Lead" } as never);

    expect(tx.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedToUserId: "user-a" }) });
  });

  it("respects an explicitly provided assignee over round-robin", async () => {
    await createLead(actor, { name: "New Lead", assignedToUserId: "user-explicit" } as never);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(tx.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedToUserId: "user-explicit" }) });
  });

  it("rejects an assignee, source or master id that belongs to another company", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    await expect(createLead(actor, { name: "New Lead", assignedToUserId: "user-foreign" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u" } as never);
    vi.mocked(prisma.crmLeadSource.findFirst).mockResolvedValue(null);
    await expect(createLead(actor, { name: "New Lead", sourceId: "src-foreign" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(prisma.productType.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.crmLeadSource.findFirst).mockResolvedValue({ id: "src" } as never);
    await expect(
      createLead(actor, { name: "New Lead", productInterestTypeIds: ["pt-1", "pt-foreign"] } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("auto-creates a 24h follow-up on every new lead", async () => {
    await createLead(actor, { name: "New Lead", assignedToUserId: "user-explicit" } as never);

    expect(tx.crmFollowup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ relatedModule: "LEAD", relatedRecordId: "lead-new", status: "PENDING" }),
    });
  });
});

describe("updateLead", () => {
  const existing = { id: "lead-1", stageId: "st-new", assignedToUserId: "user-existing", sourceId: "src-1", priority: "MEDIUM", value: 0 };

  it("rejects when the update would collide with another lead", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(existing as never);
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);

    await expect(updateLead(actor, "lead-1", { name: "Lead", email: "dup@x.com" } as never)).rejects.toMatchObject({ code: "DUPLICATE_LEAD_EXISTS" });
    expect(tx.lead.update).not.toHaveBeenCalled();
  });

  it("rejects when the lead doesn't exist in this company", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(null);
    await expect(updateLead(actor, "lead-missing", { name: "Lead" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("leaves assignment untouched (and writes no assignment history) when the field is omitted", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(existing as never);

    await updateLead(actor, "lead-1", { name: "Lead" } as never);

    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: expect.objectContaining({ assignedToUserId: "user-existing" }) });
    expect(tx.crmAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it("records a reassignment in assignment history", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(existing as never);

    await updateLead(actor, "lead-1", { name: "Lead", assignedToUserId: "user-explicit" } as never);

    expect(tx.crmAssignmentHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromUserId: "user-existing", toUserId: "user-explicit", assignedByUserId: "user-1" }),
    });
  });

  it("still unassigns when assignedToUserId is explicitly sent as an empty string", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(existing as never);

    await updateLead(actor, "lead-1", { name: "Lead", assignedToUserId: "" } as never);

    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: expect.objectContaining({ assignedToUserId: null }) });
    expect(tx.crmAssignmentHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ toUserId: null }) });
  });

  it("does not change the stage through the ordinary update", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(existing as never);

    await updateLead(actor, "lead-1", { name: "Lead", stageId: "st-won" } as never);

    const data = tx.lead.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("stageId");
  });
});

describe("changeLeadStage", () => {
  const lead = { id: "lead-1", stageId: "st-new", assignedToUserId: "user-a" };

  beforeEach(() => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(lead as never);
  });

  it("requires a lost reason when the target stage is a LOST-kind stage", async () => {
    await expect(changeLeadStage(actor, "lead-1", { stageId: "st-lost" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(tx.lead.update).not.toHaveBeenCalled();
  });

  it("rejects a lost reason from another company", async () => {
    vi.mocked(prisma.crmLostReason.findFirst).mockResolvedValue(null);
    await expect(changeLeadStage(actor, "lead-1", { stageId: "st-lost", lostReasonId: "lr-foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("marks lost with the reason snapshot, writes history + a timeline note, and schedules a revisit follow-up", async () => {
    vi.mocked(prisma.crmLostReason.findFirst).mockResolvedValue({ id: "lr-price", name: "Price Too High" } as never);

    await changeLeadStage(actor, "lead-1", {
      stageId: "st-lost",
      lostReasonId: "lr-price",
      lostCompetitor: "XYZ Exports",
      lostCanRevisit: true,
      nextFollowupAt: "2026-12-01T10:00",
    });

    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: expect.objectContaining({ stageId: "st-lost", lostReasonId: "lr-price", lostCompetitor: "XYZ Exports", lostCanRevisit: true }),
    });
    expect(tx.crmStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStageId: "st-new", toStageId: "st-lost", comment: expect.stringContaining("Price Too High") }),
    });
    expect(tx.crmActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ subject: "Stage changed: New Lead → Lost" }) });
    expect(tx.crmFollowup.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedToUserId: "user-a", status: "PENDING" }) });
  });

  it("clears the lost snapshot when a lead moves out of a lost stage", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue({ ...lead, stageId: "st-lost" } as never);

    await changeLeadStage(actor, "lead-1", { stageId: "st-contacted" });

    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: expect.objectContaining({ stageId: "st-contacted", lostReasonId: null, lostAt: null }),
    });
  });

  it("stamps wonAt when moving to a WON-kind stage", async () => {
    await changeLeadStage(actor, "lead-1", { stageId: "st-won" });
    expect(tx.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: expect.objectContaining({ wonAt: expect.any(Date) }) });
  });

  it("rejects moving to the current stage or to an inactive stage", async () => {
    await expect(changeLeadStage(actor, "lead-1", { stageId: "st-new" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(changeLeadStage(actor, "lead-1", { stageId: "st-old" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(tx.lead.update).not.toHaveBeenCalled();
  });
});
