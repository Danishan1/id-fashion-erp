import { prisma } from "@/core/db/client";
import type { ExcludedItem, PipelineItem } from "./forecast-methods";

/**
 * Open pipeline for the forecast (Phase 06, PHASE_06_FORECAST.md §3): open
 * quotations + open CRM opportunities, never counted twice. Read live from
 * the quotation and CRM tables; nothing is copied.
 */

export interface PipelineSettings {
  probabilityApproved: number;
  probabilityIssued: number;
  probabilityAccepted: number;
  staleDays: number;
  baseCurrencyCode: string;
}

/** Quotation statuses whose existence means "this opportunity is already counted (or ordered)". */
const QUOTE_REPRESENTS = new Set(["APPROVED", "ISSUED", "ACCEPTED", "CONVERTED"]);

const dbDate = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000;

export async function loadPipeline(companyId: string, today: string, s: PipelineSettings): Promise<{ items: PipelineItem[]; excluded: ExcludedItem[] }> {
  const items: PipelineItem[] = [];
  const excluded: ExcludedItem[] = [];
  const now = new Date(`${today}T12:00:00.000Z`);

  // ── Quotations ──
  const quotations = await prisma.quotation.findMany({
    where: { companyId, status: { in: ["APPROVED", "ISSUED", "ACCEPTED"] } },
    select: {
      id: true,
      quotationNumber: true,
      status: true,
      ownerUserId: true,
      createdByUserId: true,
      buyerEnquiryId: true,
      prospectName: true,
      customer: { select: { name: true, salesTerritoryId: true } },
      revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { title: true, taxableTotal: true, validUntil: true, salesOrder: { select: { id: true } } } },
    },
  });
  const quoteIds = quotations.map((q) => q.id);
  const enquiryIds = quotations.map((q) => q.buyerEnquiryId).filter((v): v is string => Boolean(v));
  const quoteLinks = quoteIds.length || enquiryIds.length
    ? await prisma.crmOpportunityErpLink.findMany({
        where: { companyId, OR: [{ docType: "QUOTATION", docId: { in: quoteIds } }, { docType: "BUYER_ENQUIRY", docId: { in: enquiryIds } }] },
        select: { docType: true, docId: true, opportunity: { select: { opportunityNumber: true, status: true, probability: true, expectedCloseDate: true } } },
      })
    : [];
  const oppForQuote = (q: { id: string; buyerEnquiryId: string | null }) =>
    quoteLinks.find((l) => l.docType === "QUOTATION" && l.docId === q.id)?.opportunity ?? (q.buyerEnquiryId ? quoteLinks.find((l) => l.docType === "BUYER_ENQUIRY" && l.docId === q.buyerEnquiryId)?.opportunity : undefined) ?? null;

  for (const q of quotations) {
    const rev = q.revisions[0];
    if (!rev) continue;
    const base = {
      source: "QUOTATION" as const,
      id: q.id,
      number: q.quotationNumber,
      label: rev.title,
      repUserId: q.ownerUserId ?? q.createdByUserId,
      territoryId: q.customer?.salesTerritoryId ?? null,
    };
    const value = Number(rev.taxableTotal);
    if (rev.salesOrder) {
      excluded.push({ ...base, value, reason: "ORDERED" });
      continue;
    }
    const validUntil = dbDate(rev.validUntil);
    if (q.status === "ISSUED" && validUntil < today) {
      excluded.push({ ...base, value, reason: "EXPIRED", detail: `Valid until ${validUntil}` });
      continue;
    }
    if (value <= 0) {
      excluded.push({ ...base, value, reason: "NO_VALUE" });
      continue;
    }
    const opp = oppForQuote(q);
    const oppOpen = opp && opp.status === "OPEN";
    const defaultProbability = q.status === "APPROVED" ? s.probabilityApproved : q.status === "ISSUED" ? s.probabilityIssued : s.probabilityAccepted;
    const useOppProbability = Boolean(oppOpen && opp!.probability !== null && q.status !== "ACCEPTED");
    const expectedDate = q.status === "ACCEPTED" ? today : oppOpen && opp!.expectedCloseDate ? dbDate(opp!.expectedCloseDate) : validUntil;
    items.push({
      ...base,
      customer: q.customer?.name ?? (q.prospectName ? `${q.prospectName} (prospect)` : "—"),
      status: q.status,
      value,
      probability: Math.min(100, Math.max(0, useOppProbability ? opp!.probability! : defaultProbability)),
      probabilitySource: useOppProbability ? "OPPORTUNITY" : "QUOTATION_DEFAULT",
      expectedDate,
      stale: false,
      opportunityNumber: opp?.opportunityNumber ?? null,
    });
  }

  // ── Opportunities ──
  const opps = await prisma.crmOpportunity.findMany({
    where: { companyId, status: "OPEN", archivedAt: null },
    select: {
      id: true,
      opportunityNumber: true,
      name: true,
      amount: true,
      currencyCode: true,
      probability: true,
      expectedCloseDate: true,
      ownerUserId: true,
      createdByUserId: true,
      updatedAt: true,
      lastActivityAt: true,
      stage: { select: { probability: true } },
      crmCompany: { select: { name: true, customer: { select: { salesTerritoryId: true } } } },
      originatingSalesOrders: { where: { status: { not: "CANCELLED" } }, select: { orderNumber: true }, take: 1 },
      erpLinks: { select: { docType: true, docId: true, docNumber: true } },
    },
  });
  const linkedQuoteIds = opps.flatMap((o) => o.erpLinks.filter((l) => l.docType === "QUOTATION").map((l) => l.docId));
  const linkedEnquiryIds = opps.flatMap((o) => o.erpLinks.filter((l) => l.docType === "BUYER_ENQUIRY").map((l) => l.docId));
  const linkedQuotes = linkedQuoteIds.length || linkedEnquiryIds.length
    ? await prisma.quotation.findMany({
        where: { companyId, OR: [{ id: { in: linkedQuoteIds } }, { buyerEnquiryId: { in: linkedEnquiryIds } }] },
        select: { id: true, quotationNumber: true, status: true, buyerEnquiryId: true },
      })
    : [];

  for (const o of opps) {
    const value = o.amount === null ? null : Number(o.amount);
    const base = { source: "OPPORTUNITY" as const, id: o.id, number: o.opportunityNumber, label: o.name, value, repUserId: o.ownerUserId ?? o.createdByUserId, territoryId: o.crmCompany?.customer?.salesTerritoryId ?? null };
    const ordered = o.originatingSalesOrders[0]?.orderNumber ?? o.erpLinks.find((l) => l.docType === "SALES_ORDER")?.docNumber;
    if (ordered) {
      excluded.push({ ...base, reason: "ORDERED", detail: ordered });
      continue;
    }
    const enquiries = new Set(o.erpLinks.filter((l) => l.docType === "BUYER_ENQUIRY").map((l) => l.docId));
    const direct = new Set(o.erpLinks.filter((l) => l.docType === "QUOTATION").map((l) => l.docId));
    const representing = linkedQuotes.find((q) => (direct.has(q.id) || (q.buyerEnquiryId && enquiries.has(q.buyerEnquiryId))) && QUOTE_REPRESENTS.has(q.status));
    if (representing) {
      excluded.push({ ...base, reason: "REPRESENTED", detail: representing.quotationNumber });
      continue;
    }
    if (o.currencyCode && o.currencyCode !== s.baseCurrencyCode) {
      excluded.push({ ...base, reason: "OTHER_CURRENCY", detail: o.currencyCode });
      continue;
    }
    if (value === null || value <= 0) {
      excluded.push({ ...base, reason: "NO_VALUE" });
      continue;
    }
    const probability = o.probability ?? o.stage?.probability ?? null;
    if (probability === null) {
      excluded.push({ ...base, reason: "NO_PROBABILITY" });
      continue;
    }
    if (!o.expectedCloseDate) {
      excluded.push({ ...base, reason: "NO_DATE" });
      continue;
    }
    items.push({
      ...base,
      value,
      customer: o.crmCompany?.name ?? "—",
      status: "OPEN",
      probability: Math.min(100, Math.max(0, probability)),
      probabilitySource: "OPPORTUNITY",
      expectedDate: dbDate(o.expectedCloseDate),
      stale: daysBetween(o.lastActivityAt ?? o.updatedAt, now) > s.staleDays,
      opportunityNumber: o.opportunityNumber,
    });
  }
  return { items, excluded };
}
