import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getQuotationScope, scopedWhere as quotationScopedWhere } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesEnquiryScope, scopedWhere as enquiryScopedWhere } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { metricTotals, sumKeys } from "@/modules/sales-marketing/performance/performance-actuals";
import { listPerformanceEvents, optionalText, recordPerformanceEvent } from "@/modules/sales-marketing/performance/performance-common";
import { periodContaining } from "@/modules/sales-marketing/performance/performance-periods";

/**
 * Sales channels (Phase 07, PHASE_07_COMMISSIONS.md §2): a flat master, and
 * the channel + external sales agent on enquiries, quotations and Sales
 * Orders. The Sales Order's channel is the one credited for the sale.
 */

const TABLE = "sales_channels";

export const channelCreateSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(1000),
    managerUserId: z.string().uuid().optional().or(z.literal("")).nullable(),
  })
  .strict();
export const channelUpdateSchema = channelCreateSchema.omit({ code: true });

async function assertManager(actor: SalesActor, userId: string | null | undefined) {
  if (!userId) return null;
  const u = await prisma.user.findFirst({ where: { id: userId, companyId: actor.companyId, status: "ACTIVE" }, select: { id: true } });
  if (!u) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user as manager.", { fieldErrors: { managerUserId: "Not an active user." } });
  return u.id;
}

export async function createChannel(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = channelCreateSchema.parse(raw);
  const managerUserId = await assertManager(actor, input.managerUserId);
  try {
    const c = await prisma.salesChannel.create({ data: { companyId: actor.companyId, code: input.code.toUpperCase(), name: input.name, description: input.description || null, managerUserId, createdByUserId: actor.userId } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: c.id, action: "CREATE", newValues: { code: c.code, name: c.name } });
    return c;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "A channel with this code already exists.", { fieldErrors: { code: "Already used." } });
    throw error;
  }
}

export async function updateChannel(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = channelUpdateSchema.parse(raw);
  const c = await prisma.salesChannel.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Channel not found.", { id });
  const managerUserId = await assertManager(actor, input.managerUserId);
  await prisma.salesChannel.updateMany({ where: { id, companyId: actor.companyId }, data: { name: input.name, description: input.description || null, managerUserId } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { name: c.name, description: c.description, managerUserId: c.managerUserId }, newValues: { ...input, managerUserId } });
  return prisma.salesChannel.findFirstOrThrow({ where: { id, companyId: actor.companyId } });
}

export async function setChannelActive(actor: SalesActor, id: string, isActive: boolean) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const { count } = await prisma.salesChannel.updateMany({ where: { id, companyId: actor.companyId, isActive: !isActive }, data: { isActive } });
  if (count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This channel is already ${isActive ? "active" : "inactive"} (or doesn't exist).`);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { isActive: !isActive }, newValues: { isActive } });
  return prisma.salesChannel.findFirstOrThrow({ where: { id, companyId: actor.companyId } });
}

/** Channels with this month's booked order value (Phase 05 metric, CHANNEL grouping). */
export async function listChannels(actor: SalesActor, raw: unknown) {
  const { status } = z.object({ status: z.enum(["active", "inactive", "all"]).optional().or(z.literal("")) }).parse(raw ?? {});
  const company = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  const month = periodContaining("MONTH", todayIsoDate(), company?.fiscalYearStartMonth ?? 1);
  const [rows, booked, canOrders] = await Promise.all([
    prisma.salesChannel.findMany({
      where: { companyId: actor.companyId, ...(!status || status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}) },
      orderBy: { code: "asc" },
      include: { manager: { select: { fullName: true } }, _count: { select: { salesOrders: true } } },
    }),
    metricTotals(actor.companyId, "BOOKED_ORDER_VALUE", month.start, month.end, "CHANNEL"),
    PermissionService.can(actor.userId, "sales_orders", "view"),
  ]);
  return {
    month: month.label,
    data: rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      active: c.isActive,
      managerUserId: c.managerUserId,
      manager: c.manager?.fullName ?? null,
      orders: c._count.salesOrders,
      bookedThisMonth: canOrders ? sumKeys(booked, [c.id]).value : null,
    })),
    noChannelThisMonth: canOrders ? sumKeys(booked, [""]).value : null,
  };
}

export async function listChannelOptions(actor: SalesActor) {
  return prisma.salesChannel.findMany({ where: { companyId: actor.companyId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

export async function listAgentOptions(actor: SalesActor) {
  return prisma.salesAgent.findMany({ where: { companyId: actor.companyId, isActive: true }, select: { id: true, code: true, name: true, commissionPercent: true }, orderBy: { name: "asc" } });
}

// ── Channel + agent on a document ───────────────────────────────

export type ChannelDocType = "ENQUIRY" | "QUOTATION" | "SALES_ORDER";

export const documentChannelSchema = z
  .object({
    salesChannelId: z.string().uuid().optional().or(z.literal("")).nullable(),
    salesAgentId: z.string().uuid().optional().or(z.literal("")).nullable(),
    reason: optionalText(1000),
  })
  .strict();

const PERMISSION: Record<ChannelDocType, [Parameters<typeof PermissionService.assert>[1], Parameters<typeof PermissionService.assert>[2]]> = {
  ENQUIRY: ["sales_marketing", "edit"],
  QUOTATION: ["sales_quotations", "edit"],
  // Same rule as the order's sales credit (Phase 05): it changes what the sale is credited to.
  SALES_ORDER: ["sales_performance", "edit"],
};

async function loadDoc(actor: SalesActor, docType: ChannelDocType, id: string) {
  const select = { id: true, salesChannelId: true, salesAgentId: true, salesChannel: { select: { name: true, code: true } }, salesAgent: { select: { name: true, code: true } } };
  if (docType === "ENQUIRY") {
    const scope = await getSalesEnquiryScope(actor);
    const d = await prisma.buyerEnquiry.findFirst({ where: enquiryScopedWhere(actor, scope, { id }), select: { ...select, enquiryNumber: true } });
    return d ? { ...d, number: d.enquiryNumber } : null;
  }
  if (docType === "QUOTATION") {
    const scope = await getQuotationScope(actor);
    const d = await prisma.quotation.findFirst({ where: quotationScopedWhere(actor, scope, { id }), select: { ...select, quotationNumber: true } });
    return d ? { ...d, number: d.quotationNumber } : null;
  }
  const d = await prisma.salesOrder.findFirst({ where: { id, companyId: actor.companyId }, select: { ...select, orderNumber: true } });
  return d ? { ...d, number: d.orderNumber } : null;
}

export async function getDocumentChannel(actor: SalesActor, docType: ChannelDocType, id: string) {
  const d = await loadDoc(actor, docType, id);
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id });
  const history = docType === "SALES_ORDER" ? (await listPerformanceEvents(prisma, actor.companyId, "SALES_ORDER", id)).filter((e) => e.type === "CHANNEL_CHANGED") : [];
  return {
    salesChannelId: d.salesChannelId,
    salesChannel: d.salesChannel ? `${d.salesChannel.name} (${d.salesChannel.code})` : null,
    salesAgentId: d.salesAgentId,
    salesAgent: d.salesAgent ? `${d.salesAgent.name} (${d.salesAgent.code})` : null,
    history,
  };
}

export async function setDocumentChannel(actor: SalesActor, docType: ChannelDocType, id: string, raw: unknown) {
  const [module, action] = PERMISSION[docType];
  await PermissionService.assert(actor.userId, module, action);
  const input = documentChannelSchema.parse(raw);
  const d = await loadDoc(actor, docType, id);
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id });
  const channelId = input.salesChannelId || null;
  const agentId = input.salesAgentId || null;
  if (channelId === d.salesChannelId && agentId === d.salesAgentId) throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed.");
  if (docType === "SALES_ORDER" && !input.reason) throw new BusinessRuleError("VALIDATION_ERROR", "Say why — it changes what this sale is credited to.", { fieldErrors: { reason: "Required." } });
  const [channel, agent] = await Promise.all([
    channelId ? prisma.salesChannel.findFirst({ where: { id: channelId, companyId: actor.companyId }, select: { name: true, isActive: true } }) : null,
    agentId ? prisma.salesAgent.findFirst({ where: { id: agentId, companyId: actor.companyId }, select: { name: true, isActive: true } }) : null,
  ]);
  if (channelId && (!channel || (!channel.isActive && channelId !== d.salesChannelId))) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active channel.", { fieldErrors: { salesChannelId: "Not an active channel." } });
  if (agentId && (!agent || (!agent.isActive && agentId !== d.salesAgentId))) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active sales agent.", { fieldErrors: { salesAgentId: "Not an active agent." } });
  const data = { salesChannelId: channelId, salesAgentId: agentId };
  const where = { id, companyId: actor.companyId, salesChannelId: d.salesChannelId, salesAgentId: d.salesAgentId };
  await prisma.$transaction(async (tx) => {
    const { count } =
      docType === "ENQUIRY" ? await tx.buyerEnquiry.updateMany({ where, data }) : docType === "QUOTATION" ? await tx.quotation.updateMany({ where, data }) : await tx.salesOrder.updateMany({ where, data });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This record changed just now. Reload and try again.");
    const before = { channel: d.salesChannel?.name ?? null, agent: d.salesAgent?.name ?? null };
    const after = { channel: channel?.name ?? null, agent: agent?.name ?? null };
    if (docType === "SALES_ORDER") await recordPerformanceEvent(tx, actor, "SALES_ORDER", id, "CHANNEL_CHANGED", input.reason || null, { orderNumber: d.number, before, after });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: docType === "ENQUIRY" ? "buyer_enquiries" : docType === "QUOTATION" ? "quotations" : "sales_orders", recordId: id, action: "UPDATE", oldValues: { salesChannelId: d.salesChannelId, salesAgentId: d.salesAgentId }, newValues: { ...data, reason: input.reason || null } },
      tx
    );
  });
  return getDocumentChannel(actor, docType, id);
}
