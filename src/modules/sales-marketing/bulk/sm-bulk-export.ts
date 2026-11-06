import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { ExportCell, ExportColumn } from "@/modules/bulk-actions/bulk-export-file";
import type { BulkActor } from "@/modules/bulk-actions/bulk-types";
import { measureBudgets } from "../budgets/budget.service";
import { CAMPAIGN_STATUSES, PRIORITY_LABELS } from "../campaigns/campaign-registry";
import { ENQUIRY_SOURCES, SALES_ENQUIRY_PRIORITIES, SALES_ENQUIRY_STAGES } from "../enquiries/sales-enquiry-registry";
import { APPLY_MODES, DISCOUNT_TYPES, displayStatus, DISPLAY_LABELS } from "../promotions/promotion-registry";
import { QUOTATION_STATUSES } from "../quotations/quotation-registry";
import { campaignWhere, enquiryWhere, promotionWhere, quotationWhere, type SmBulkEntityKey } from "./sm-bulk-entities";
import { todayIsoDate, toIsoDate } from "@/lib/date";

/**
 * Phase 14 (S&M) — export rows. Each batch is read AS THE REQUESTER through the
 * same where-builder as the list (visibility applied), so an export can never
 * contain a record the user couldn't open. Campaign exports include the
 * Phase 12 budget figures (approved budget, actual, committed, remaining).
 */

export type SmExportEntity = Exclude<SmBulkEntityKey, "ATTRIBUTION_MODEL">;

const d = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const label = <T extends Record<string, { label: string }>>(map: T, key: string | null | undefined) => (key && key in map ? map[key as keyof T].label : (key ?? null));

const COLUMNS: Record<SmExportEntity, ExportColumn[]> = {
  ENQUIRY: [
    { header: "Enquiry #" }, { header: "Enquiry date", type: "date" }, { header: "Subject", width: 30 }, { header: "Customer", width: 26 }, { header: "Prospect", width: 26 },
    { header: "CRM company", width: 24 }, { header: "Source" }, { header: "Sales stage" }, { header: "Priority" }, { header: "Owner", width: 22 },
    { header: "Next follow-up", type: "date" }, { header: "Estimated value", type: "number" }, { header: "Expected decision", type: "date" }, { header: "Lines", type: "number" }, { header: "Created", type: "date" },
  ],
  QUOTATION: [
    { header: "Quotation #" }, { header: "Revision", type: "number" }, { header: "Title", width: 30 }, { header: "Status" }, { header: "Customer", width: 26 }, { header: "Prospect", width: 26 },
    { header: "Enquiry #" }, { header: "Owner", width: 22 }, { header: "Quotation date", type: "date" }, { header: "Valid until", type: "date" }, { header: "Currency" }, { header: "Grand total", type: "number" }, { header: "Created", type: "date" },
  ],
  CAMPAIGN: [
    { header: "Code" }, { header: "Name", width: 30 }, { header: "Status" }, { header: "Type" }, { header: "Objective" }, { header: "Priority" }, { header: "Owner", width: 22 },
    { header: "Department" }, { header: "Channel" }, { header: "Planned start", type: "date" }, { header: "Planned end", type: "date" }, { header: "Actual start", type: "date" }, { header: "Actual end", type: "date" },
    { header: "Currency" }, { header: "Approved budget", type: "number" }, { header: "Actual spend", type: "number" }, { header: "Committed", type: "number" }, { header: "In approval", type: "number" }, { header: "Remaining", type: "number" }, { header: "Used %", type: "number" },
  ],
  PROMOTION: [
    { header: "Code" }, { header: "Name", width: 30 }, { header: "Status" }, { header: "Applies" }, { header: "Owner", width: 22 }, { header: "Approved version", type: "number" },
    { header: "Discount type" }, { header: "Value", type: "number" }, { header: "Valid from", type: "date" }, { header: "Valid to", type: "date" }, { header: "Max redemptions", type: "number" }, { header: "Updated", type: "date" },
  ],
};

export const smExportColumns = (e: SmExportEntity) => COLUMNS[e];

export async function smExportRows(actor: BulkActor, entityType: SmExportEntity, ids: string[]): Promise<Map<string, ExportCell[]>> {
  const out = new Map<string, ExportCell[]>();
  if (!ids.length) return out;
  if (entityType === "ENQUIRY") {
    // view=all: an export of selected ids includes closed ones the user can see.
    const where = { AND: [await enquiryWhere(actor, { view: "all" }), { id: { in: ids } }] };
    const rows = await prisma.buyerEnquiry.findMany({
      where,
      include: { customer: { select: { name: true } }, crmCompany: { select: { name: true } }, owner: { select: { fullName: true } }, _count: { select: { lines: true } } },
    });
    for (const r of rows)
      out.set(r.id, [r.enquiryNumber, d(r.enquiryDate), r.subject, r.customer?.name ?? null, r.prospectName, r.crmCompany?.name ?? null, (ENQUIRY_SOURCES[r.source as keyof typeof ENQUIRY_SOURCES] ?? r.source), label(SALES_ENQUIRY_STAGES, r.salesStage), label(SALES_ENQUIRY_PRIORITIES, r.priority), r.owner?.fullName ?? null, d(r.nextFollowUpDate), n(r.estimatedValue), d(r.expectedDecisionDate), r._count.lines, d(r.createdAt)]);
  } else if (entityType === "QUOTATION") {
    const where = { AND: [await quotationWhere(actor, { view: "all" }), { id: { in: ids } }] };
    const rows = await prisma.quotation.findMany({
      where,
      include: { customer: { select: { name: true } }, owner: { select: { fullName: true } }, buyerEnquiry: { select: { enquiryNumber: true } }, revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
    });
    for (const r of rows) {
      const rev = r.revisions[0];
      out.set(r.id, [r.quotationNumber, rev?.revisionNumber ?? null, rev?.title ?? null, label(QUOTATION_STATUSES, r.status), r.customer?.name ?? null, r.prospectName, r.buyerEnquiry?.enquiryNumber ?? null, r.owner?.fullName ?? null, d(rev?.quotationDate), d(rev?.validUntil), rev?.currencyCode ?? null, n(rev?.grandTotal), d(r.createdAt)]);
    }
  } else if (entityType === "CAMPAIGN") {
    const where = { AND: [await campaignWhere(actor, {}), { id: { in: ids } }] };
    const rows = await prisma.marketingCampaign.findMany({
      where,
      include: { type: { select: { name: true } }, objective: { select: { name: true } }, owner: { select: { fullName: true } }, department: { select: { name: true } }, salesChannel: { select: { name: true } } },
    });
    const budgets = await measureBudgets(actor.companyId, rows);
    for (const c of rows) {
      const b = budgets.get(c.id);
      out.set(c.id, [c.code, c.name, label(CAMPAIGN_STATUSES, c.status), c.type.name, c.objective.name, PRIORITY_LABELS[c.priority as keyof typeof PRIORITY_LABELS] ?? c.priority, c.owner.fullName, c.department?.name ?? null, c.salesChannel?.name ?? null, d(c.plannedStartDate), d(c.plannedEndDate), d(c.actualStartDate), d(c.actualEndDate), c.currencyCode, b?.limit ?? null, b?.actual ?? null, b?.committed ?? null, b?.pipeline ?? null, b?.remaining ?? null, b?.usedPercent ?? null]);
    }
  } else {
    // status "ALL" isn't a list status: the where then keeps every status (archived included) for selected ids.
    const where = { AND: [promotionWhere(actor, { status: "ALL" }), { id: { in: ids } }] };
    const rows = await prisma.marketingPromotion.findMany({ where, include: { approvedVersion: true, owner: { select: { fullName: true } } } });
    const today = todayIsoDate();
    for (const p of rows) {
      const v = p.approvedVersion;
      const approved = v ? { validFrom: toIsoDate(v.validFrom), validTo: v.validTo ? toIsoDate(v.validTo) : null } : null;
      out.set(p.id, [p.code, p.name, DISPLAY_LABELS[displayStatus(p.status, approved, today)].label, APPLY_MODES[p.applyMode as keyof typeof APPLY_MODES]?.label ?? p.applyMode, p.owner.fullName, v?.versionNumber ?? null, v ? (DISCOUNT_TYPES[v.discountType as keyof typeof DISCOUNT_TYPES] ?? v.discountType) : null, n(v?.value), d(v?.validFrom), d(v?.validTo), v?.maxRedemptions ?? null, d(p.updatedAt)]);
    }
  }
  return out;
}
