import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { toIsoDate } from "@/lib/date";
import { BOOKED_ORDER_STATUSES, INVOICED_STATUSES } from "@/modules/sales-marketing/performance/performance-registry";
import { endOfBusinessDay } from "./attribution-math";

/**
 * Reads authoritative records into touchpoints and conversions (Phase 13).
 * Idempotent and incremental: each source is read from its checkpoint
 * (records whose updated_at moved, with a 5-minute overlap for clock /
 * commit races); rows are keyed by a stable dedup key / (type, record), and
 * an unchanged row is not rewritten. Nothing in the source records is changed.
 *
 *   Message touches    marketing_deliveries ever accepted by the provider (Phase 10):
 *                      MESSAGE_DELIVERED when delivery was confirmed, else MESSAGE_SENT;
 *                      bounced / rejected / failed afterwards → EXCLUDED.
 *                      Identity: the contact, and the customer its CRM company is linked to.
 *   Campaign responses the campaign set on a lead, enquiry, quotation or Sales Order
 *                      (one touch per record + campaign; a removed / changed campaign → EXCLUDED).
 *   Conversions        lead created · enquiry created · quotation revision accepted ·
 *                      Sales Order booked (confirmed or later; cancelled → REVERSED).
 *
 * Identity keys are typed record ids (CONTACT:, CUSTOMER:, LEAD:, ENQUIRY:,
 * QUOTATION:, ORDER:) taken from existing links — no matching on names,
 * e-mails or phone numbers.
 */

type Db = typeof prisma;
const OVERLAP_MS = 5 * 60_000;
const BATCH = 500;
const MAX_PER_SOURCE = 20_000;
export const SYNC_SOURCES = ["DELIVERY", "LEAD", "ENQUIRY", "QUOTATION", "SALES_ORDER", "SALES_INVOICE"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

const key = (type: string, id: string | null | undefined) => (id ? `${type}:${id}` : null);
const keys = (...k: (string | null)[]) => [...new Set(k.filter((x): x is string => Boolean(x)))].sort();
const dec = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP));
const sameDec = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => (a === null || b === null ? a === b : a.eq(b));
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

interface TouchIn {
  sourceType: "DELIVERY" | "LEAD" | "ENQUIRY" | "QUOTATION" | "SALES_ORDER";
  sourceId: string;
  dedupKey: string;
  touchpointType: "MESSAGE_SENT" | "MESSAGE_DELIVERED" | "CAMPAIGN_RESPONSE";
  campaignId: string;
  channelType: string | null;
  providerKey: string | null;
  identityKeys: string[];
  occurredAt: Date;
  status: "VALID" | "EXCLUDED";
  excludedReason: string | null;
}

interface ConversionIn {
  conversionType: "LEAD_CREATED" | "ENQUIRY_CREATED" | "QUOTATION_ACCEPTED" | "SALES_ORDER_BOOKED";
  sourceId: string;
  sourceRevisionId: string | null;
  reference: string;
  occurredAt: Date;
  businessDate: Date;
  identityKeys: string[];
  status: "ACTIVE" | "REVERSED" | "REMOVED";
  statusReason: string | null;
  quotedValue: Prisma.Decimal | null;
  orderValue: Prisma.Decimal | null;
  invoicedValue: Prisma.Decimal | null;
}

/** Writes touches, skipping unchanged ones. Returns how many rows changed. */
async function writeTouches(db: Db, companyId: string, rows: TouchIn[]) {
  if (!rows.length) return 0;
  const existing = new Map((await db.marketingTouchpoint.findMany({ where: { companyId, dedupKey: { in: rows.map((r) => r.dedupKey) } } })).map((t) => [t.dedupKey, t]));
  let changed = 0;
  for (const r of rows) {
    const e = existing.get(r.dedupKey);
    if (
      e &&
      e.touchpointType === r.touchpointType &&
      e.campaignId === r.campaignId &&
      e.channelType === r.channelType &&
      e.occurredAt.getTime() === r.occurredAt.getTime() &&
      e.status === r.status &&
      e.excludedReason === r.excludedReason &&
      sameArr(e.identityKeys, r.identityKeys)
    )
      continue;
    await db.marketingTouchpoint.upsert({ where: { companyId_dedupKey: { companyId, dedupKey: r.dedupKey } }, create: { companyId, ...r }, update: r });
    changed++;
  }
  return changed;
}

/** Campaign tags: the record's current campaign is VALID; any earlier campaign tag of the record becomes EXCLUDED. */
async function writeTags(db: Db, companyId: string, sourceType: TouchIn["sourceType"], records: { id: string; campaignId: string | null; createdAt: Date; identityKeys: string[] }[]) {
  if (!records.length) return 0;
  const rows: TouchIn[] = [];
  for (const r of records) {
    if (r.campaignId) {
      rows.push({ sourceType, sourceId: r.id, dedupKey: `${sourceType}:${r.id}:${r.campaignId}`, touchpointType: "CAMPAIGN_RESPONSE", campaignId: r.campaignId, channelType: null, providerKey: null, identityKeys: r.identityKeys, occurredAt: r.createdAt, status: "VALID", excludedReason: null });
    }
  }
  let changed = await writeTouches(db, companyId, rows);
  // Earlier tags of these records that no longer match the record's campaign.
  const stale = await db.marketingTouchpoint.findMany({ where: { companyId, sourceType, sourceId: { in: records.map((r) => r.id) }, status: "VALID" }, select: { id: true, sourceId: true, campaignId: true } });
  const current = new Map(records.map((r) => [r.id, r.campaignId]));
  const gone = stale.filter((t) => current.get(t.sourceId) !== t.campaignId).map((t) => t.id);
  if (gone.length) changed += (await db.marketingTouchpoint.updateMany({ where: { id: { in: gone } }, data: { status: "EXCLUDED", excludedReason: "The campaign was removed from the record." } })).count;
  return changed;
}

async function writeConversions(db: Db, companyId: string, rows: ConversionIn[]) {
  if (!rows.length) return 0;
  const existing = await db.marketingConversion.findMany({ where: { companyId, OR: rows.map((r) => ({ conversionType: r.conversionType, sourceId: r.sourceId })) } });
  const byKey = new Map(existing.map((c) => [`${c.conversionType}|${c.sourceId}`, c]));
  let changed = 0;
  for (const r of rows) {
    const e = byKey.get(`${r.conversionType}|${r.sourceId}`);
    if (!e && r.status !== "ACTIVE") continue; // never booked: nothing to reverse
    if (
      e &&
      e.status === r.status &&
      e.statusReason === r.statusReason &&
      e.reference === r.reference &&
      e.sourceRevisionId === r.sourceRevisionId &&
      e.occurredAt.getTime() === r.occurredAt.getTime() &&
      sameArr(e.identityKeys, r.identityKeys) &&
      sameDec(e.quotedValue, r.quotedValue) &&
      sameDec(e.orderValue, r.orderValue) &&
      sameDec(e.invoicedValue, r.invoicedValue)
    )
      continue;
    await db.marketingConversion.upsert({
      where: { companyId_conversionType_sourceId: { companyId, conversionType: r.conversionType, sourceId: r.sourceId } },
      create: { companyId, ...r },
      update: r,
    });
    changed++;
  }
  return changed;
}

// ── Sources ────────────────────────────────────────────────────────

async function deliveries(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const rows = await db.marketingDelivery.findMany({
    where: { companyId, acceptedAt: { not: null }, updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: {
      id: true,
      status: true,
      acceptedAt: true,
      deliveredAt: true,
      contactId: true,
      updatedAt: true,
      run: { select: { campaignId: true, channelType: true, providerKey: true } },
      contact: { select: { crmCompany: { select: { customerId: true } } } },
    },
  });
  const touches: TouchIn[] = rows.map((d) => {
    const delivered = d.status === "DELIVERED" || Boolean(d.deliveredAt);
    const failed = ["BOUNCED", "REJECTED", "FAILED"].includes(d.status) && !delivered;
    return {
      sourceType: "DELIVERY",
      sourceId: d.id,
      dedupKey: `DELIVERY:${d.id}`,
      touchpointType: delivered ? "MESSAGE_DELIVERED" : "MESSAGE_SENT",
      campaignId: d.run.campaignId,
      channelType: d.run.channelType,
      providerKey: d.run.providerKey,
      identityKeys: keys(key("CONTACT", d.contactId), key("CUSTOMER", d.contact.crmCompany?.customerId)),
      occurredAt: (delivered ? (d.deliveredAt ?? d.acceptedAt) : d.acceptedAt)!,
      status: failed ? "EXCLUDED" : "VALID",
      excludedReason: failed ? `The provider reported ${d.status.toLowerCase()} after accepting it.` : null,
    };
  });
  return { count: rows.length, last: rows.at(-1) ? { at: rows.at(-1)!.updatedAt, id: rows.at(-1)!.id } : null, changed: await writeTouches(db, companyId, touches) };
}

async function leads(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const rows = await db.crmLead.findMany({
    where: { companyId, updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true, leadNumber: true, campaignId: true, crmContactId: true, createdAt: true, updatedAt: true },
  });
  const ids = (l: (typeof rows)[number]) => keys(key("LEAD", l.id), key("CONTACT", l.crmContactId));
  let changed = await writeTags(db, companyId, "LEAD", rows.map((l) => ({ id: l.id, campaignId: l.campaignId, createdAt: l.createdAt, identityKeys: ids(l) })));
  changed += await writeConversions(
    db,
    companyId,
    rows.map((l) => ({ conversionType: "LEAD_CREATED", sourceId: l.id, sourceRevisionId: null, reference: l.leadNumber, occurredAt: l.createdAt, businessDate: new Date(`${toIsoDate(l.createdAt)}T00:00:00Z`), identityKeys: ids(l), status: "ACTIVE", statusReason: null, quotedValue: null, orderValue: null, invoicedValue: null }))
  );
  return { count: rows.length, last: rows.at(-1) ? { at: rows.at(-1)!.updatedAt, id: rows.at(-1)!.id } : null, changed };
}

async function enquiries(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const rows = await db.buyerEnquiry.findMany({
    where: { companyId, updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true, enquiryNumber: true, campaignId: true, crmContactId: true, customerId: true, createdAt: true, updatedAt: true },
  });
  const ids = (e: (typeof rows)[number]) => keys(key("ENQUIRY", e.id), key("CONTACT", e.crmContactId), key("CUSTOMER", e.customerId));
  let changed = await writeTags(db, companyId, "ENQUIRY", rows.map((e) => ({ id: e.id, campaignId: e.campaignId, createdAt: e.createdAt, identityKeys: ids(e) })));
  changed += await writeConversions(
    db,
    companyId,
    rows.map((e) => ({ conversionType: "ENQUIRY_CREATED", sourceId: e.id, sourceRevisionId: null, reference: e.enquiryNumber, occurredAt: e.createdAt, businessDate: new Date(`${toIsoDate(e.createdAt)}T00:00:00Z`), identityKeys: ids(e), status: "ACTIVE", statusReason: null, quotedValue: null, orderValue: null, invoicedValue: null }))
  );
  return { count: rows.length, last: rows.at(-1) ? { at: rows.at(-1)!.updatedAt, id: rows.at(-1)!.id } : null, changed };
}

async function quotations(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const rows = await db.quotation.findMany({
    where: { companyId, updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: {
      id: true,
      quotationNumber: true,
      campaignId: true,
      crmContactId: true,
      customerId: true,
      buyerEnquiryId: true,
      createdAt: true,
      updatedAt: true,
      revisions: { where: { status: "ACCEPTED" }, orderBy: { revisionNumber: "desc" }, take: 1, select: { id: true, revisionNumber: true, customerDecisionAt: true, taxableTotal: true } },
    },
  });
  const ids = (q: (typeof rows)[number]) => keys(key("QUOTATION", q.id), key("ENQUIRY", q.buyerEnquiryId), key("CONTACT", q.crmContactId), key("CUSTOMER", q.customerId));
  let changed = await writeTags(db, companyId, "QUOTATION", rows.map((q) => ({ id: q.id, campaignId: q.campaignId, createdAt: q.createdAt, identityKeys: ids(q) })));
  const conv: ConversionIn[] = rows.map((q) => {
    const r = q.revisions[0];
    if (!r || !r.customerDecisionAt) {
      return { conversionType: "QUOTATION_ACCEPTED", sourceId: q.id, sourceRevisionId: null, reference: q.quotationNumber, occurredAt: q.updatedAt, businessDate: new Date(`${toIsoDate(q.updatedAt)}T00:00:00Z`), identityKeys: ids(q), status: "REMOVED", statusReason: "No accepted revision.", quotedValue: null, orderValue: null, invoicedValue: null };
    }
    const day = toIsoDate(r.customerDecisionAt);
    return { conversionType: "QUOTATION_ACCEPTED", sourceId: q.id, sourceRevisionId: r.id, reference: `${q.quotationNumber} rev ${r.revisionNumber}`, occurredAt: endOfBusinessDay(day), businessDate: new Date(`${day}T00:00:00Z`), identityKeys: ids(q), status: "ACTIVE", statusReason: null, quotedValue: dec(r.taxableTotal), orderValue: null, invoicedValue: null };
  });
  changed += await writeConversions(db, companyId, conv);
  return { count: rows.length, last: rows.at(-1) ? { at: rows.at(-1)!.updatedAt, id: rows.at(-1)!.id } : null, changed };
}

async function invoicedByOrder(db: Db, companyId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Prisma.Decimal>();
  const inv = await db.salesInvoice.findMany({ where: { companyId, salesOrderId: { in: orderIds }, status: { in: [...INVOICED_STATUSES] } }, select: { salesOrderId: true, subtotalAmount: true, exchangeRate: true } });
  const out = new Map<string, Prisma.Decimal>();
  for (const i of inv) out.set(i.salesOrderId, (out.get(i.salesOrderId) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(i.subtotalAmount).mul(i.exchangeRate)));
  return out;
}

const booked = (status: string, before: string | null) => (BOOKED_ORDER_STATUSES as readonly string[]).includes(status) || (status === "ON_HOLD" && before !== null && (BOOKED_ORDER_STATUSES as readonly string[]).includes(before));

async function orderRows(db: Db, companyId: string, where: Prisma.SalesOrderWhereInput) {
  return db.salesOrder.findMany({
    where: { companyId, ...where },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: {
      id: true,
      orderNumber: true,
      campaignId: true,
      customerId: true,
      status: true,
      statusBeforeHold: true,
      orderDate: true,
      baseTotalAmount: true,
      createdAt: true,
      updatedAt: true,
      sourceQuotationRevision: { select: { quotationId: true, quotation: { select: { buyerEnquiryId: true } } } },
    },
  });
}

async function writeOrders(db: Db, companyId: string, rows: Awaited<ReturnType<typeof orderRows>>) {
  const ids = (o: (typeof rows)[number]) =>
    keys(key("ORDER", o.id), key("CUSTOMER", o.customerId), key("QUOTATION", o.sourceQuotationRevision?.quotationId), key("ENQUIRY", o.sourceQuotationRevision?.quotation.buyerEnquiryId));
  let changed = await writeTags(db, companyId, "SALES_ORDER", rows.map((o) => ({ id: o.id, campaignId: o.campaignId, createdAt: o.createdAt, identityKeys: ids(o) })));
  const invoiced = await invoicedByOrder(db, companyId, rows.map((o) => o.id));
  changed += await writeConversions(
    db,
    companyId,
    rows.map((o) => {
      const day = toIsoDate(o.orderDate);
      const isBooked = booked(o.status, o.statusBeforeHold);
      return {
        conversionType: "SALES_ORDER_BOOKED",
        sourceId: o.id,
        sourceRevisionId: null,
        reference: o.orderNumber,
        occurredAt: endOfBusinessDay(day),
        businessDate: new Date(`${day}T00:00:00Z`),
        identityKeys: ids(o),
        status: isBooked ? "ACTIVE" : "REVERSED",
        statusReason: isBooked ? null : o.status === "CANCELLED" ? "The Sales Order was cancelled." : `The Sales Order is ${o.status.toLowerCase().replace(/_/g, " ")}.`,
        quotedValue: null,
        orderValue: dec(o.baseTotalAmount),
        invoicedValue: dec(invoiced.get(o.id) ?? 0),
      } satisfies ConversionIn;
    })
  );
  return changed;
}

async function salesOrders(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const rows = await orderRows(db, companyId, { updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) });
  return { count: rows.length, last: rows.at(-1) ? { at: rows.at(-1)!.updatedAt, id: rows.at(-1)!.id } : null, changed: await writeOrders(db, companyId, rows) };
}

/** A changed invoice re-reads its order (the invoiced value lives on the order's conversion). */
async function salesInvoices(db: Db, companyId: string, since: Date, after: { at: Date; id: string } | null) {
  const inv = await db.salesInvoice.findMany({
    where: { companyId, updatedAt: { gte: since }, ...(after ? { OR: [{ updatedAt: { gt: after.at } }, { updatedAt: after.at, id: { gt: after.id } }] } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: BATCH,
    select: { id: true, salesOrderId: true, updatedAt: true },
  });
  const orders = inv.length ? await orderRows(db, companyId, { id: { in: [...new Set(inv.map((i) => i.salesOrderId))] } }) : [];
  return { count: inv.length, last: inv.at(-1) ? { at: inv.at(-1)!.updatedAt, id: inv.at(-1)!.id } : null, changed: await writeOrders(db, companyId, orders) };
}

const READERS: Record<SyncSource, typeof deliveries> = { DELIVERY: deliveries, LEAD: leads, ENQUIRY: enquiries, QUOTATION: quotations, SALES_ORDER: salesOrders, SALES_INVOICE: salesInvoices };

/**
 * Brings touchpoints and conversions of one company up to date. Safe to run
 * concurrently with itself (idempotent upserts) and to retry. Returns per
 * source how many records were read and how many rows changed.
 */
export async function syncAttributionSources(companyId: string, opts: { full?: boolean } = {}, db: Db = prisma) {
  const startedAt = new Date();
  const out: Record<string, { read: number; changed: number; complete: boolean }> = {};
  const cps = new Map((await db.marketingAttributionCheckpoint.findMany({ where: { companyId } })).map((c) => [c.source, c]));
  for (const source of SYNC_SOURCES) {
    const cp = cps.get(source);
    const since = opts.full || !cp ? new Date(0) : new Date(cp.syncedUpTo.getTime() - OVERLAP_MS);
    let after: { at: Date; id: string } | null = null;
    let read = 0;
    let changed = 0;
    let complete = false;
    while (read < MAX_PER_SOURCE) {
      const r = await READERS[source](db, companyId, since, after);
      read += r.count;
      changed += r.changed;
      if (r.last) after = r.last;
      if (r.count < BATCH) {
        complete = true;
        break;
      }
    }
    // Checkpoint: everything up to the start of this sync when complete, else up to the last record read.
    const upTo = complete ? startedAt : (after?.at ?? since);
    await db.marketingAttributionCheckpoint.upsert({
      where: { companyId_source: { companyId, source } },
      create: { companyId, source, syncedUpTo: upTo, lastSyncAt: new Date(), processed: read },
      update: { syncedUpTo: upTo, lastSyncAt: new Date(), processed: read },
    });
    out[source] = { read, changed, complete };
  }
  return { startedAt, sources: out };
}

/** When each source was last read (freshness on the dashboard). */
export async function syncStatus(companyId: string) {
  const rows = await prisma.marketingAttributionCheckpoint.findMany({ where: { companyId } });
  return SYNC_SOURCES.map((s) => {
    const r = rows.find((x) => x.source === s);
    return { source: s, syncedUpTo: r?.syncedUpTo.toISOString() ?? null, lastSyncAt: r?.lastSyncAt.toISOString() ?? null };
  });
}
