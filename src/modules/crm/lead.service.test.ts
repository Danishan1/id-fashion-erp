import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
// Same 80/50 pair the hardcoded literals used to be — keeps every existing
// priority assertion in this file valid now that thresholds are a real
// per-company DB setting rather than a literal inside computeLeadPriority.
vi.mock("./crm-settings.service", () => ({
  getCrmSettings: vi.fn().mockResolvedValue({ hotThreshold: 80, warmThreshold: 50 }),
  DEFAULT_LEAD_PRIORITY_THRESHOLDS: { hotThreshold: 80, warmThreshold: 50 },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    crmFollowup: { create: vi.fn() },
  },
}));
vi.mock("./lead.repository", () => ({
  LeadRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findAnyById: vi.fn(),
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
const { computeLeadPriority, createLead, updateLead } = await import("./lead.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("LEAD-2026-00001");
  vi.mocked(LeadRepository.create).mockReset();
  vi.mocked(LeadRepository.update).mockReset();
  vi.mocked(LeadRepository.findAnyById).mockReset();
  vi.mocked(LeadRepository.findDuplicates).mockReset().mockResolvedValue([]);
  vi.mocked(CrmRoundRobinRepository.findOrCreate).mockReset();
  vi.mocked(CrmRoundRobinRepository.updateLastAssigned).mockReset();
  vi.mocked(prisma.user.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.crmFollowup.create).mockReset().mockResolvedValue({} as never);
});

describe("computeLeadPriority", () => {
  it("is HOT at exactly the 80 threshold and above", () => {
    expect(computeLeadPriority(80)).toBe("HOT");
    expect(computeLeadPriority(95)).toBe("HOT");
  });

  it("is WARM at exactly the 50 threshold, below 80", () => {
    expect(computeLeadPriority(50)).toBe("WARM");
    expect(computeLeadPriority(79.9)).toBe("WARM");
  });

  it("is NORMAL below 50", () => {
    expect(computeLeadPriority(0)).toBe("NORMAL");
    expect(computeLeadPriority(49.9)).toBe("NORMAL");
  });

  it("handles a Decimal-shaped string the same as a number", () => {
    expect(computeLeadPriority("80.00")).toBe("HOT");
  });

  it("uses a custom threshold pair instead of the 80/50 default when one is supplied", () => {
    const custom = { hotThreshold: 90, warmThreshold: 60 };
    expect(computeLeadPriority(85, custom)).toBe("WARM"); // would be HOT under the default 80 cutoff
    expect(computeLeadPriority(55, custom)).toBe("NORMAL"); // would be WARM under the default 50 cutoff
    expect(computeLeadPriority(90, custom)).toBe("HOT");
  });
});

describe("createLead", () => {
  it("rejects when a duplicate email/phone already exists", async () => {
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);

    await expect(createLead(actor, { name: "New Lead", email: "a@b.com", source: "OTHER" } as never)).rejects.toMatchObject({
      code: "DUPLICATE_LEAD_EXISTS",
    });
    expect(LeadRepository.create).not.toHaveBeenCalled();
  });

  it("succeeds despite a duplicate when overrideDuplicateCheck is set", async () => {
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);
    vi.mocked(LeadRepository.create).mockResolvedValue({ id: "lead-new", leadScore: "0" } as never);

    await createLead(actor, { name: "New Lead", email: "a@b.com", source: "OTHER", overrideDuplicateCheck: true } as never);

    expect(LeadRepository.create).toHaveBeenCalled();
  });

  it("auto-assigns via round-robin when assignedToUserId is left blank", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-a" }, { id: "user-b" }, { id: "user-c" }] as never);
    vi.mocked(CrmRoundRobinRepository.findOrCreate).mockResolvedValue({ companyId: "co-1", lastAssignedUserId: "user-a" } as never);
    vi.mocked(LeadRepository.create).mockResolvedValue({ id: "lead-new", leadScore: "0" } as never);

    await createLead(actor, { name: "New Lead", source: "OTHER" } as never);

    // last was user-a (index 0) -> next is user-b (index 1)
    expect(CrmRoundRobinRepository.updateLastAssigned).toHaveBeenCalledWith("co-1", "user-b");
    expect(LeadRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assignedToUserId: "user-b" }));
  });

  it("wraps back to the first user once the last one has been assigned", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user-a" }, { id: "user-b" }] as never);
    vi.mocked(CrmRoundRobinRepository.findOrCreate).mockResolvedValue({ companyId: "co-1", lastAssignedUserId: "user-b" } as never);
    vi.mocked(LeadRepository.create).mockResolvedValue({ id: "lead-new", leadScore: "0" } as never);

    await createLead(actor, { name: "New Lead", source: "OTHER" } as never);

    expect(LeadRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assignedToUserId: "user-a" }));
  });

  it("respects an explicitly provided assignedToUserId over round-robin", async () => {
    vi.mocked(LeadRepository.create).mockResolvedValue({ id: "lead-new", leadScore: "0" } as never);

    await createLead(actor, { name: "New Lead", source: "OTHER", assignedToUserId: "user-explicit" } as never);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(LeadRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assignedToUserId: "user-explicit" }));
  });

  it("auto-creates a 24h follow-up on every new lead", async () => {
    vi.mocked(LeadRepository.create).mockResolvedValue({ id: "lead-new", leadScore: "0" } as never);

    await createLead(actor, { name: "New Lead", source: "OTHER", assignedToUserId: "user-explicit" } as never);

    expect(prisma.crmFollowup.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relatedModule: "LEAD", relatedRecordId: "lead-new", status: "PENDING" }) })
    );
  });
});

describe("updateLead", () => {
  it("rejects when the update would collide with another lead's email/phone", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue({ id: "lead-1", status: "NEW" } as never);
    vi.mocked(LeadRepository.findDuplicates).mockResolvedValue([{ id: "lead-x", leadNumber: "LEAD-2026-00000", name: "Existing" }] as never);

    await expect(updateLead(actor, "lead-1", { name: "Lead", email: "dup@x.com", source: "OTHER" } as never)).rejects.toMatchObject({
      code: "DUPLICATE_LEAD_EXISTS",
    });
    expect(LeadRepository.update).not.toHaveBeenCalled();
  });

  it("rejects when the lead doesn't exist in this company", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(null);

    await expect(updateLead(actor, "lead-missing", { name: "Lead", source: "OTHER" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
