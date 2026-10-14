import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ticketFindFirst: vi.fn(),
  ticketFindUnique: vi.fn(),
  ticketFindUniqueOrThrow: vi.fn(),
  ticketFindMany: vi.fn(),
  ticketCreate: vi.fn(),
  ticketUpdate: vi.fn(),
  ticketGroupBy: vi.fn(),
  messageCreate: vi.fn(),
  attachmentFindFirst: vi.fn(),
  platformUserFindUnique: vi.fn(),
  isAdmin: vi.fn(),
  docNumber: vi.fn(),
  notify: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const client = {
    supportTicket: {
      findFirst: m.ticketFindFirst,
      findUnique: m.ticketFindUnique,
      findUniqueOrThrow: m.ticketFindUniqueOrThrow,
      findMany: m.ticketFindMany,
      create: m.ticketCreate,
      update: m.ticketUpdate,
      groupBy: m.ticketGroupBy,
    },
    supportTicketMessage: { create: m.messageCreate },
    supportTicketAttachment: { findFirst: m.attachmentFindFirst },
    platformUser: { findUnique: m.platformUserFindUnique },
  };
  return { prisma: { ...client, $transaction: async (fn: (t: typeof client) => unknown) => fn(client) } };
});
vi.mock("@/modules/support-access/support-access.service", () => ({ isCompanySupportAdmin: m.isAdmin }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: m.docNumber }));
vi.mock("@/core/notifications/NotificationService", () => ({ createNotification: m.notify }));
vi.mock("@/core/file-storage/FileStorage", () => ({
  saveFile: m.saveFile,
  deleteStoredFile: m.deleteFile,
  readStoredFile: vi.fn(),
  UnsupportedFileTypeError: class extends Error {},
  FileTooLargeError: class extends Error {},
}));

const svc = await import("./support-ticket.service");
const tenant = { userId: "u-1", companyId: "co-1" };
const platform = { platformUserId: "pu-1", role: "SUPPORT_AGENT" as const };
const ticket = {
  id: "t-1",
  companyId: "co-1",
  ticketNumber: "TKT-2026-00001",
  subject: "Can't post invoice",
  status: "OPEN",
  createdByUserId: "u-1",
  assignedToPlatformUserId: null,
};

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.isAdmin.mockResolvedValue(false);
  m.docNumber.mockResolvedValue("TKT-2026-00001");
  m.deleteFile.mockResolvedValue(undefined);
  m.saveFile.mockImplementation(async (_b: Buffer, name: string) => ({ storageKey: `key-${name}`, fileSizeBytes: 10 }));
  m.ticketCreate.mockImplementation(async ({ data }) => ({ id: "t-1", ...data }));
  m.messageCreate.mockImplementation(async ({ data }) => ({ id: "msg-1", ...data }));
});

describe("customer side", () => {
  it("creates a ticket with its first message and attachments", async () => {
    await svc.createTicket(
      tenant,
      { subject: "Can't post invoice", category: "BUG", priority: "HIGH", body: "It errors every time." },
      [{ buffer: Buffer.from("x"), fileName: "shot.png", mimeType: "image/png" }]
    );
    expect(m.docNumber).toHaveBeenCalledWith({ companyId: "co-1", branchId: null, documentType: "SUPPORT_TICKET" });
    const data = m.ticketCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ companyId: "co-1", ticketNumber: "TKT-2026-00001", createdByUserId: "u-1" });
    expect(data.messages.create.attachments.create).toEqual([
      { fileName: "shot.png", mimeType: "image/png", storageKey: "key-shot.png", fileSizeBytes: 10 },
    ]);
  });

  it("removes stored files when the ticket can't be saved", async () => {
    m.ticketCreate.mockRejectedValue(new Error("db down"));
    await expect(
      svc.createTicket(tenant, { subject: "Subject x", category: "BUG", priority: "LOW", body: "Body text here" }, [
        { buffer: Buffer.from("x"), fileName: "a.png", mimeType: "image/png" },
      ])
    ).rejects.toThrow("db down");
    expect(m.deleteFile).toHaveBeenCalledWith("key-a.png");
  });

  it("refuses more attachments than allowed", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ buffer: Buffer.from("x"), fileName: `${i}.png`, mimeType: "image/png" }));
    await expect(
      svc.createTicket(tenant, { subject: "Subject x", category: "BUG", priority: "LOW", body: "Body text here" }, files)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(m.saveFile).not.toHaveBeenCalled();
  });

  it("an ordinary user sees only their own tickets; the Super Admin sees the company's", async () => {
    m.ticketFindMany.mockResolvedValue([]);
    await svc.listTenantTickets(tenant);
    expect(m.ticketFindMany.mock.calls[0][0].where).toEqual({ companyId: "co-1", createdByUserId: "u-1" });

    m.isAdmin.mockResolvedValue(true);
    const res = await svc.listTenantTickets(tenant);
    expect(m.ticketFindMany.mock.calls[1][0].where).toEqual({ companyId: "co-1" });
    expect(res.seesAllCompanyTickets).toBe(true);
  });

  it("never returns internal notes to the customer", async () => {
    m.ticketFindFirst.mockResolvedValue(ticket);
    m.ticketFindUniqueOrThrow.mockResolvedValue(ticket);
    await svc.getTenantTicket(tenant, "t-1");
    expect(m.ticketFindUniqueOrThrow.mock.calls[0][0].include.messages.where).toEqual({ isInternal: false });
  });

  it("can't open another user's ticket", async () => {
    m.ticketFindFirst.mockResolvedValue(null);
    await expect(svc.getTenantTicket(tenant, "t-9")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a customer reply reopens a ticket waiting on them", async () => {
    m.ticketFindFirst.mockResolvedValue({ ...ticket, status: "WAITING_ON_CUSTOMER" });
    await svc.replyAsCustomer(tenant, "t-1", "Still broken");
    expect(m.ticketUpdate.mock.calls[0][0].data).toMatchObject({ status: "OPEN", lastMessageBy: "CUSTOMER" });
  });

  it("can't reply to a closed ticket", async () => {
    m.ticketFindFirst.mockResolvedValue({ ...ticket, status: "CLOSED" });
    await expect(svc.replyAsCustomer(tenant, "t-1", "Hello")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("statusAfterCustomerReply keeps an in-progress ticket in progress", () => {
    expect(svc.statusAfterCustomerReply("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(svc.statusAfterCustomerReply("RESOLVED")).toBe("OPEN");
  });
});

describe("platform side", () => {
  it("a reply waits on the customer, assigns the ticket and notifies the creator", async () => {
    m.ticketFindUnique.mockResolvedValue(ticket);
    await svc.replyAsPlatform(platform, "t-1", { body: "Fixed, please retry", isInternal: false });
    expect(m.ticketUpdate.mock.calls[0][0].data).toMatchObject({
      status: "WAITING_ON_CUSTOMER",
      lastMessageBy: "PLATFORM",
      assignedToPlatformUserId: "pu-1",
    });
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ companyId: "co-1", userId: "u-1" }), expect.anything());
  });

  it("an internal note changes nothing the customer sees and sends no notification", async () => {
    m.ticketFindUnique.mockResolvedValue({ ...ticket, assignedToPlatformUserId: "pu-2" });
    await svc.replyAsPlatform(platform, "t-1", { body: "Looks like a data issue", isInternal: true });
    expect(m.messageCreate.mock.calls[0][0].data).toMatchObject({ isInternal: true });
    expect(m.ticketUpdate.mock.calls[0][0].data).toEqual({});
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("a closed ticket can't be reopened", async () => {
    m.ticketFindUnique.mockResolvedValue({ ...ticket, status: "CLOSED" });
    await expect(svc.updatePlatformTicket("t-1", { status: "OPEN" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("resolving notifies the customer and stamps resolvedAt", async () => {
    m.ticketFindUnique.mockResolvedValue(ticket);
    m.ticketUpdate.mockResolvedValue({ ...ticket, status: "RESOLVED" });
    await svc.updatePlatformTicket("t-1", { status: "RESOLVED" });
    expect(m.ticketUpdate.mock.calls[0][0].data).toMatchObject({ status: "RESOLVED", resolvedAt: expect.any(Date) });
    expect(m.notify).toHaveBeenCalled();
  });

  it("only assigns to an active platform user", async () => {
    m.ticketFindUnique.mockResolvedValue(ticket);
    m.platformUserFindUnique.mockResolvedValue({ status: "SUSPENDED" });
    await expect(
      svc.updatePlatformTicket("t-1", { assignedToPlatformUserId: "11111111-1111-1111-1111-111111111111" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
