import type { Prisma, PlatformUserRole, SupportTicketStatus } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { createNotification } from "@/core/notifications/NotificationService";
import {
  FileTooLargeError,
  UnsupportedFileTypeError,
  deleteStoredFile,
  readStoredFile,
  saveFile,
} from "@/core/file-storage/FileStorage";
import { logger } from "@/core/logging/logger";
import { isCompanySupportAdmin } from "@/modules/support-access/support-access.service";
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_STATUS_LABELS,
  type CreateTicketInput,
  type PlatformReplyInput,
  type PlatformTicketUpdateInput,
} from "./support-ticket.schema";

/**
 * Support tickets (Platform SaaS Phase 5, PLAT-028..030).
 *
 * Customers: any active user raises tickets and sees their own; the
 * company's Super Admin sees every ticket of the company. Tickets don't go
 * through PermissionService on purpose, so a company in read-only grace /
 * expired mode can still ask for help.
 *
 * Platform staff: one inbox across all companies. Internal notes are
 * platform-only and never returned to customers. CLOSED is final.
 */

export interface TenantActor {
  userId: string;
  companyId: string;
}

export interface PlatformActor {
  platformUserId: string;
  role: PlatformUserRole;
}

export interface IncomingFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const ATTACHMENT_SELECT = { id: true, fileName: true, mimeType: true, fileSizeBytes: true, createdAt: true } as const;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Saves files before the DB write; the caller deletes them again if the write fails. */
async function storeFiles(files: IncomingFile[]) {
  if (files.length > MAX_TICKET_ATTACHMENTS) {
    throw new BusinessRuleError("VALIDATION_ERROR", `You can attach at most ${MAX_TICKET_ATTACHMENTS} files per message.`);
  }
  const stored: { fileName: string; mimeType: string; fileSizeBytes: number; storageKey: string }[] = [];
  try {
    for (const f of files) {
      const saved = await saveFile(f.buffer, f.fileName, f.mimeType);
      stored.push({ fileName: f.fileName, mimeType: f.mimeType, ...saved });
    }
  } catch (err) {
    await discardFiles(stored);
    if (err instanceof UnsupportedFileTypeError || err instanceof FileTooLargeError) {
      throw new BusinessRuleError("VALIDATION_ERROR", err.message);
    }
    throw err;
  }
  return stored;
}

async function discardFiles(stored: { storageKey: string }[]) {
  for (const s of stored) {
    await deleteStoredFile(s.storageKey).catch((error) =>
      logger.warn("Couldn't remove an unused ticket attachment", { storageKey: s.storageKey, error })
    );
  }
}

/** Next status after a customer writes: a ticket waiting on them / resolved goes back to OPEN. */
export function statusAfterCustomerReply(current: SupportTicketStatus): SupportTicketStatus {
  if (current === "CLOSED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This ticket is closed. Open a new ticket instead.");
  return current === "WAITING_ON_CUSTOMER" || current === "RESOLVED" ? "OPEN" : current;
}

function lifecycleDates(status: SupportTicketStatus, now: Date) {
  return {
    resolvedAt: status === "RESOLVED" ? now : undefined,
    closedAt: status === "CLOSED" ? now : undefined,
  };
}

// ---------------------------------------------------------------------------
// Customer side
// ---------------------------------------------------------------------------

async function tenantScope(actor: TenantActor): Promise<Prisma.SupportTicketWhereInput> {
  const admin = await isCompanySupportAdmin(actor);
  return admin ? { companyId: actor.companyId } : { companyId: actor.companyId, createdByUserId: actor.userId };
}

async function getTenantTicketOrThrow(actor: TenantActor, id: string) {
  const ticket = await prisma.supportTicket.findFirst({ where: { id, ...(await tenantScope(actor)) } });
  if (!ticket) throw new BusinessRuleError("NOT_FOUND", "Ticket not found.");
  return ticket;
}

export async function createTicket(actor: TenantActor, input: CreateTicketInput, files: IncomingFile[] = []) {
  const stored = await storeFiles(files);
  try {
    const ticketNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "SUPPORT_TICKET" });
    return await prisma.supportTicket.create({
      data: {
        companyId: actor.companyId,
        ticketNumber,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        createdByUserId: actor.userId,
        lastMessageBy: "CUSTOMER",
        messages: {
          create: {
            authorType: "CUSTOMER",
            authorUserId: actor.userId,
            body: input.body,
            attachments: { create: stored },
          },
        },
      },
    });
  } catch (err) {
    await discardFiles(stored);
    throw err;
  }
}

export async function listTenantTickets(actor: TenantActor, filters: { status?: "OPEN_ONLY" | "ALL" } = {}) {
  const scope = await tenantScope(actor);
  const where: Prisma.SupportTicketWhereInput = {
    ...scope,
    ...(filters.status === "OPEN_ONLY" ? { status: { notIn: ["RESOLVED", "CLOSED"] } } : {}),
  };
  const tickets = await prisma.supportTicket.findMany({
    where,
    include: { createdBy: { select: { fullName: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 500,
  });
  return { tickets, seesAllCompanyTickets: !("createdByUserId" in scope) };
}

export async function getTenantTicket(actor: TenantActor, id: string) {
  await getTenantTicketOrThrow(actor, id);
  return prisma.supportTicket.findUniqueOrThrow({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      messages: {
        where: { isInternal: false },
        include: {
          authorUser: { select: { fullName: true } },
          // Customers see "Support team", not the individual operator.
          attachments: { select: ATTACHMENT_SELECT },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function replyAsCustomer(actor: TenantActor, id: string, body: string, files: IncomingFile[] = []) {
  const ticket = await getTenantTicketOrThrow(actor, id);
  const nextStatus = statusAfterCustomerReply(ticket.status);
  const stored = await storeFiles(files);
  try {
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
      const message = await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorType: "CUSTOMER",
          authorUserId: actor.userId,
          body,
          attachments: { create: stored },
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: { status: nextStatus, lastMessageAt: now, lastMessageBy: "CUSTOMER", resolvedAt: nextStatus === "OPEN" ? null : undefined },
      });
      return message;
    });
  } catch (err) {
    await discardFiles(stored);
    throw err;
  }
}

export async function closeTicketAsCustomer(actor: TenantActor, id: string) {
  const ticket = await getTenantTicketOrThrow(actor, id);
  if (ticket.status === "CLOSED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This ticket is already closed.");
  return prisma.supportTicket.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
}

export async function getTenantAttachment(actor: TenantActor, attachmentId: string) {
  const attachment = await prisma.supportTicketAttachment.findFirst({
    where: { id: attachmentId, message: { isInternal: false, ticket: await tenantScope(actor) } },
  });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "File not found.");
  return { attachment, buffer: await readStoredFile(attachment.storageKey) };
}

// ---------------------------------------------------------------------------
// Platform side
// ---------------------------------------------------------------------------

export interface PlatformTicketFilters {
  status?: SupportTicketStatus | "ACTIVE" | "ALL";
  companyId?: string;
  assigned?: "ME" | "UNASSIGNED";
  search?: string;
}

export async function listPlatformTickets(actor: PlatformActor, filters: PlatformTicketFilters = {}) {
  const where: Prisma.SupportTicketWhereInput = {};
  const status = filters.status ?? "ACTIVE";
  if (status === "ACTIVE") where.status = { notIn: ["RESOLVED", "CLOSED"] };
  else if (status !== "ALL") where.status = status;
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.assigned === "ME") where.assignedToPlatformUserId = actor.platformUserId;
  if (filters.assigned === "UNASSIGNED") where.assignedToPlatformUserId = null;
  const q = filters.search?.trim();
  if (q) {
    where.OR = [
      { ticketNumber: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [tickets, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        createdBy: { select: { fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
      // Customer-last first (they're waiting on us), newest activity first.
      orderBy: [{ lastMessageBy: "asc" }, { lastMessageAt: "desc" }],
      take: 500,
    }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    tickets,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<SupportTicketStatus, number>>,
  };
}

export async function getPlatformTicket(id: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, isActive: true } },
      createdBy: { select: { fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true } },
      messages: {
        include: {
          authorUser: { select: { fullName: true } },
          authorPlatformUser: { select: { fullName: true } },
          attachments: { select: ATTACHMENT_SELECT },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!ticket) throw new BusinessRuleError("NOT_FOUND", "Ticket not found.");
  return ticket;
}

export async function replyAsPlatform(actor: PlatformActor, id: string, input: PlatformReplyInput, files: IncomingFile[] = []) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new BusinessRuleError("NOT_FOUND", "Ticket not found.");
  if (ticket.status === "CLOSED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This ticket is closed.");
  const nextStatus: SupportTicketStatus | undefined = input.isInternal
    ? input.status
    : (input.status ?? "WAITING_ON_CUSTOMER");

  const stored = await storeFiles(files);
  try {
    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorType: "PLATFORM",
          authorPlatformUserId: actor.platformUserId,
          body: input.body,
          isInternal: input.isInternal,
          attachments: { create: stored },
        },
      });
      await tx.supportTicket.update({
        where: { id },
        data: {
          ...(nextStatus ? { status: nextStatus, ...lifecycleDates(nextStatus, now) } : {}),
          ...(input.isInternal ? {} : { lastMessageAt: now, lastMessageBy: "PLATFORM" as const }),
          // First reply picks the ticket up if nobody owns it yet.
          ...(ticket.assignedToPlatformUserId ? {} : { assignedToPlatformUserId: actor.platformUserId }),
        },
      });
      if (!input.isInternal) {
        await createNotification(
          {
            companyId: ticket.companyId,
            userId: ticket.createdByUserId,
            title: `Support replied: ${ticket.ticketNumber}`,
            body: `${ticket.subject} — ${TICKET_STATUS_LABELS[nextStatus ?? ticket.status]}`,
          },
          tx
        );
      }
      return created;
    });
    return message;
  } catch (err) {
    await discardFiles(stored);
    throw err;
  }
}

export async function updatePlatformTicket(id: string, input: PlatformTicketUpdateInput) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new BusinessRuleError("NOT_FOUND", "Ticket not found.");
  if (ticket.status === "CLOSED" && input.status && input.status !== "CLOSED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A closed ticket can't be reopened. The customer can open a new one.");
  }
  let assignee: string | null | undefined;
  if (input.assignedToPlatformUserId !== undefined) {
    assignee = input.assignedToPlatformUserId || null;
    if (assignee) {
      const user = await prisma.platformUser.findUnique({ where: { id: assignee }, select: { status: true } });
      if (!user || user.status !== "ACTIVE") throw new BusinessRuleError("NOT_FOUND", "Platform user not found or inactive.");
    }
  }
  const now = new Date();
  const updated = await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(input.status && input.status !== ticket.status ? { status: input.status, ...lifecycleDates(input.status, now) } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(assignee !== undefined ? { assignedToPlatformUserId: assignee } : {}),
    },
  });
  if (input.status && input.status !== ticket.status && (input.status === "RESOLVED" || input.status === "CLOSED")) {
    await createNotification({
      companyId: ticket.companyId,
      userId: ticket.createdByUserId,
      title: `Ticket ${TICKET_STATUS_LABELS[input.status].toLowerCase()}: ${ticket.ticketNumber}`,
      body: ticket.subject,
    });
  }
  return updated;
}

export async function getPlatformAttachment(attachmentId: string) {
  const attachment = await prisma.supportTicketAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "File not found.");
  return { attachment, buffer: await readStoredFile(attachment.storageKey) };
}

export async function listAssignablePlatformUsers() {
  return prisma.platformUser.findMany({
    where: { status: "ACTIVE", role: { in: ["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"] } },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
}

/** Sidebar badge for the platform inbox: tickets waiting on a platform reply. */
export async function countTicketsAwaitingPlatform() {
  return prisma.supportTicket.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] }, lastMessageBy: "CUSTOMER" } });
}
