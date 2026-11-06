import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeBulkExportFile } from "@/modules/bulk-actions/bulk-export-file";
import type { BulkActor, BulkItemOutcome } from "@/modules/bulk-actions/bulk-types";
import { crmEntityWhere, type CrmBulkEntityKey } from "./crm-bulk-entities";

/**
 * Phase 14 — CRM export as a bulk action. Each job item reads its record AS
 * THE REQUESTER (same visibility rule as the list) and stores its row on the
 * item; finalize writes the CSV / XLSX once all items are done, through the
 * app's existing private file storage (never under public/), then clears the
 * per-item copies. Every text cell is formula-injection safe.
 */

export const EXPORT_MAX_ROWS = 20_000;
export const EXPORT_TTL_DAYS = 7;

type Cell = string | number | Date | null;
interface ExportColumn {
  header: string;
  type?: "date" | "number";
  width?: number;
}

const d = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

const COLUMNS: Record<CrmBulkEntityKey, ExportColumn[]> = {
  LEAD: [
    { header: "Lead #" }, { header: "Name", width: 26 }, { header: "Company", width: 26 }, { header: "Email", width: 28 }, { header: "Phone" }, { header: "Mobile" },
    { header: "Status" }, { header: "Source" }, { header: "Owner", width: 22 }, { header: "Temperature" }, { header: "Score", type: "number" }, { header: "Estimated value", type: "number" },
    { header: "Currency" }, { header: "City" }, { header: "Country" }, { header: "Industry" }, { header: "Tags", width: 26 }, { header: "Next follow-up", type: "date" },
    { header: "Last contacted", type: "date" }, { header: "Created", type: "date" }, { header: "Archived", type: "date" },
  ],
  CONTACT: [
    { header: "Name", width: 26 }, { header: "Company", width: 26 }, { header: "Designation" }, { header: "Department" }, { header: "Email", width: 28 }, { header: "Phone" },
    { header: "Mobile" }, { header: "WhatsApp" }, { header: "Owner", width: 22 }, { header: "Source" }, { header: "Tags", width: 26 }, { header: "Last activity", type: "date" },
    { header: "Created", type: "date" }, { header: "Archived", type: "date" },
  ],
  COMPANY: [
    { header: "Name", width: 28 }, { header: "Legal name", width: 28 }, { header: "Type" }, { header: "Industry" }, { header: "Status" }, { header: "Email", width: 28 },
    { header: "Phone" }, { header: "Website", width: 26 }, { header: "City" }, { header: "State" }, { header: "Country" }, { header: "Owner", width: 22 },
    { header: "Tags", width: 26 }, { header: "Created", type: "date" }, { header: "Archived", type: "date" },
  ],
  OPPORTUNITY: [
    { header: "Opportunity #" }, { header: "Name", width: 28 }, { header: "Company", width: 26 }, { header: "Contact", width: 22 }, { header: "Pipeline" }, { header: "Stage" },
    { header: "Status" }, { header: "Amount", type: "number" }, { header: "Currency" }, { header: "Probability %", type: "number" }, { header: "Expected close", type: "date" },
    { header: "Owner", width: 22 }, { header: "Tags", width: 26 }, { header: "Created", type: "date" }, { header: "Closed", type: "date" }, { header: "Close reason", width: 26 }, { header: "Archived", type: "date" },
  ],
};

export function exportColumns(entityType: CrmBulkEntityKey) {
  return COLUMNS[entityType];
}

async function tagNames(companyId: string, entityType: CrmBulkEntityKey, ids: string[]) {
  const rows = await prisma.crmEntityTag.findMany({ where: { companyId, entityType, entityId: { in: ids } }, select: { entityId: true, tag: { select: { name: true } } } });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.entityId, [...(map.get(r.entityId) ?? []), r.tag.name]);
  return (id: string) => (map.get(id) ?? []).sort().join(", ");
}

/** Rows (as the requester may see them) for a batch of ids; missing ids are not visible / gone. */
export async function exportRows(actor: BulkActor, entityType: CrmBulkEntityKey, ids: string[]): Promise<Map<string, Cell[]>> {
  const out = new Map<string, Cell[]>();
  const base = await crmEntityWhere(actor, entityType, { archived: "include" });
  const where = { AND: [base, { id: { in: ids } }] };
  const tags = await tagNames(actor.companyId, entityType, ids);
  if (entityType === "LEAD") {
    const rows = await prisma.crmLead.findMany({ where: where as Prisma.CrmLeadWhereInput, include: { status: { select: { name: true } }, source: { select: { name: true } }, owner: { select: { fullName: true } } } });
    for (const r of rows)
      out.set(r.id, [r.leadNumber, r.fullName, r.companyName, r.email, r.phone, r.mobile, r.status.name, r.source?.name ?? null, r.owner?.fullName ?? null, r.temperature, r.score, n(r.estimatedValue), r.currencyCode, r.city, r.country, r.industry, tags(r.id), d(r.nextFollowUpAt), d(r.lastContactedAt), d(r.createdAt), d(r.archivedAt)]);
  } else if (entityType === "CONTACT") {
    const rows = await prisma.crmContact.findMany({ where: where as Prisma.CrmContactWhereInput, include: { crmCompany: { select: { name: true } }, source: { select: { name: true } }, owner: { select: { fullName: true } } } });
    for (const r of rows)
      out.set(r.id, [r.fullName, r.crmCompany?.name ?? null, r.designation, r.department, r.email, r.phone, r.mobile, r.whatsapp, r.owner?.fullName ?? null, r.source?.name ?? null, tags(r.id), d(r.lastActivityAt), d(r.createdAt), d(r.archivedAt)]);
  } else if (entityType === "COMPANY") {
    const rows = await prisma.crmCompany.findMany({ where: where as Prisma.CrmCompanyWhereInput, include: { status: { select: { name: true } }, owner: { select: { fullName: true } } } });
    for (const r of rows)
      out.set(r.id, [r.name, r.legalName, r.companyType, r.industry, r.status?.name ?? null, r.email, r.phone, r.website, r.city, r.state, r.country, r.owner?.fullName ?? null, tags(r.id), d(r.createdAt), d(r.archivedAt)]);
  } else {
    const rows = await prisma.crmOpportunity.findMany({
      where: where as Prisma.CrmOpportunityWhereInput,
      include: { crmCompany: { select: { name: true } }, crmContact: { select: { fullName: true } }, pipeline: { select: { name: true } }, stage: { select: { name: true } }, owner: { select: { fullName: true } } },
    });
    for (const r of rows)
      out.set(r.id, [r.opportunityNumber, r.name, r.crmCompany?.name ?? null, r.crmContact?.fullName ?? null, r.pipeline?.name ?? null, r.stage?.name ?? null, r.status, n(r.amount), r.currencyCode, r.probability, d(r.expectedCloseDate), r.owner?.fullName ?? null, tags(r.id), d(r.createdAt), d(r.closedAt), r.closeReason, d(r.archivedAt)]);
  }
  return out;
}

export function exportOutcome(row: Cell[] | undefined): BulkItemOutcome {
  if (!row) return { status: "SKIPPED", message: "Not exported: the record no longer exists or is not visible to you." };
  return { status: "SUCCEEDED", result: { row } };
}

/** Builds the file from the SUCCEEDED items' rows (in selection order), stores it privately and clears the per-item copies. */
export async function writeExportFile(job: { id: string; companyId: string; createdAt: Date }, entityType: CrmBulkEntityKey, format: "CSV" | "XLSX", pluralLabel: string) {
  return writeBulkExportFile(job, COLUMNS[entityType], format, pluralLabel);
}
