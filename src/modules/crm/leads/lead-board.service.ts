import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import type { CrmActor } from "../core/crm-actor";
import { getCrmRecordScope } from "../core/crm-visibility";
import { tagsByEntity } from "../tags/crm-tags.service";
import { buildLeadWhere } from "./lead-filters";
import { LEAD_LIST_SELECT, LeadRepository } from "./lead.repository";
import { parseLeadFilterParams } from "./lead.schema";

/** Board paging options; the lead filters themselves are parsed with parseLeadFilterParams. */
export const leadBoardQuerySchema = z.object({
  perStatus: z.coerce.number().int().min(0).max(100).default(20),
  /** Load one column only (next page: with `offset`). */
  statusId: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lead board: one column per lead status (in the configured order), with the
 * same server-side filters as the lead list, per-column paging and backend
 * totals (count, estimated value and average per currency) over the filtered,
 * visible set. Archived leads never appear. Inactive statuses appear only
 * while leads still use them. Status changes are not made here — the board
 * calls the existing POST /leads/{id}/status (or Convert).
 */
export async function getLeadBoard(actor: CrmActor, raw: Record<string, unknown>) {
  const q = leadBoardQuerySchema.parse(raw);
  const sp = new URLSearchParams(Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][]);
  const filter = { ...parseLeadFilterParams(sp), archived: "exclude" as const };
  const scope = await getCrmRecordScope(actor);
  const tagMatched = filter.tagIds?.length ? (await LeadRepository.entityIdsWithAnyTag(actor.companyId, "LEAD", filter.tagIds)).map((r) => r.entityId) : undefined;
  const where = buildLeadWhere(actor.companyId, filter, scope, tagMatched);

  const [statuses, groups] = await Promise.all([
    prisma.crmLeadStatus.findMany({ where: { companyId: actor.companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.crmLead.groupBy({ by: ["statusId", "currencyCode"], where, _count: { _all: true, estimatedValue: true }, _sum: { estimatedValue: true } }),
  ]);
  const counts = new Map<string, number>();
  const money = new Map<string, { currencyCode: string | null; total: number; valued: number }[]>();
  for (const g of groups) {
    counts.set(g.statusId, (counts.get(g.statusId) ?? 0) + g._count._all);
    if (g._sum.estimatedValue === null) continue;
    money.set(g.statusId, [...(money.get(g.statusId) ?? []), { currencyCode: g.currencyCode, total: Number(g._sum.estimatedValue), valued: g._count.estimatedValue }]);
  }
  const columns = statuses.filter((s) => (q.statusId ? s.id === q.statusId : s.isActive || counts.get(s.id)));
  const pageOf = (statusId: string) =>
    q.perStatus
      ? prisma.crmLead.findMany({
          where: { AND: [where, { statusId }] } as Prisma.CrmLeadWhereInput,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: q.offset,
          take: q.perStatus,
          select: { ...LEAD_LIST_SELECT, customFields: true },
        })
      : Promise.resolve([]);
  const pages = await Promise.all(columns.map((s) => pageOf(s.id)));
  const tags = await tagsByEntity(actor.companyId, "LEAD", pages.flat().map((r) => r.id));

  return {
    offset: q.offset,
    statuses: columns.map((s, i) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      color: s.color,
      sortOrder: s.sortOrder,
      isDefault: s.isDefault,
      archived: !s.isActive,
      count: counts.get(s.id) ?? 0,
      values: (money.get(s.id) ?? []).map((m) => ({ currencyCode: m.currencyCode, total: round2(m.total), average: m.valued ? round2(m.total / m.valued) : null })),
      records: pages[i].map((r) => ({
        ...r,
        estimatedValue: r.estimatedValue === null ? null : r.estimatedValue.toString(),
        ownerInactive: r.owner ? r.owner.status !== "ACTIVE" : false,
        tags: tags.get(r.id) ?? [],
      })),
      hasMore: (counts.get(s.id) ?? 0) > q.offset + pages[i].length,
    })),
  };
}
