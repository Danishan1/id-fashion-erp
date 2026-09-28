import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    crmLeadContact: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { createLeadContact, deleteLeadContact, listLeadContacts, updateLeadContact } = await import("./lead-contact.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => vi.clearAllMocks());

describe("lead contacts", () => {
  it("only lists/creates contacts on a lead in the actor's own company", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null);
    await expect(listLeadContacts("co-1", "lead-foreign")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLeadContact(actor, "lead-foreign", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.crmLeadContact.create).not.toHaveBeenCalled();
  });

  it("creates a contact scoped to the company, blank optional fields stored as null", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "lead-1" } as never);
    vi.mocked(prisma.crmLeadContact.create).mockResolvedValue({ id: "c-1" } as never);

    await createLeadContact(actor, "lead-1", { name: "Priya", designation: "", email: "priya@abc.com" });

    expect(prisma.crmLeadContact.create).toHaveBeenCalledWith({
      data: { companyId: "co-1", leadId: "lead-1", name: "Priya", designation: null, email: "priya@abc.com", phone: null, whatsappNumber: null, notes: null },
    });
  });

  it("cannot edit or delete another company's contact", async () => {
    vi.mocked(prisma.crmLeadContact.findFirst).mockResolvedValue(null);
    await expect(updateLeadContact(actor, "c-foreign", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteLeadContact(actor, "c-foreign")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.crmLeadContact.update).not.toHaveBeenCalled();
    expect(prisma.crmLeadContact.delete).not.toHaveBeenCalled();
  });
});
