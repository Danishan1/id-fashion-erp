import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import type { CrmActor } from "../core/crm-actor";
import { runCrmMutation } from "../core/crm-mutation";
import { CrmErpRepository } from "../erp/crm-erp.repository";
import { loadEditableOpportunity, loadOpportunityForActor, refreshOpportunitySearchText } from "./crm-opportunities.service";
import { CrmOpportunityRepository } from "./crm-opportunity.repository";
import { ERP_DOC_TYPE_KEYS, ERP_DOC_TYPES, type ErpDocType } from "./opportunity-registry";
import { erpDocumentSearchSchema, linkErpDocumentSchema } from "./opportunity.schema";

/**
 * An opportunity's references to authoritative ERP documents (several per
 * opportunity, e.g. revisions). Only the document id and number are stored
 * (crm_opportunity_erp_links); date, status, amount and customer are always
 * read live from the ERP, each section only with that ERP module's view
 * permission and the viewer's branch access. The CRM never creates, edits or
 * deletes ERP documents, and never copies their amounts into the opportunity.
 *
 * The ERP has no quotation module: when one exists, add a "QUOTATION"
 * provider below and an ERP_DOC_TYPES entry (no migration needed).
 */

export interface ErpDocView {
  id: string;
  number: string;
  date: Date;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  /** Ship-by / submission date where the document has one. */
  dueDate: Date | null;
  subtitle: string | null;
  customerId: string | null;
  customerName: string | null;
  person: string | null;
  href: string;
}

type Branch = ReturnType<typeof branchScopeWhere>;
interface Provider {
  load(companyId: string, ids: string[], branch: Branch): Promise<ErpDocView[]>;
  search(companyId: string, opts: { customerId: string | null; term?: string }, branch: Branch, take: number): Promise<ErpDocView[]>;
}

const money = (v: unknown) => (v === null || v === undefined ? null : String(v));
const contains = (term?: string) => (term ? { contains: term, mode: "insensitive" as const } : undefined);

const PROVIDERS: Record<ErpDocType, Provider> = {
  BUYER_ENQUIRY: {
    async load(companyId, ids, branch) {
      return (await CrmErpRepository.buyerEnquiryDocs({ companyId, id: { in: ids }, ...branch }, ids.length)).map(enquiryView);
    },
    async search(companyId, { customerId, term }, branch, take) {
      return (await CrmErpRepository.buyerEnquiryDocs({ companyId, ...(customerId ? { customerId } : {}), ...(term ? { enquiryNumber: contains(term) } : {}), ...branch }, take)).map(enquiryView);
    },
  },
  // Sales & Marketing quotations (2026-10-29): company-wide documents (no
  // branch); amount and status are those of the current revision.
  QUOTATION: {
    async load(companyId, ids) {
      return (await CrmErpRepository.quotationDocs({ companyId, id: { in: ids } }, ids.length)).map(quotationView);
    },
    async search(companyId, { customerId, term }, _branch, take) {
      return (
        await CrmErpRepository.quotationDocs(
          { companyId, ...(customerId ? { customerId } : {}), ...(term ? { OR: [{ quotationNumber: contains(term) }, { prospectName: contains(term) }, { revisions: { some: { title: contains(term) } } }] } : {}) },
          take
        )
      ).map(quotationView);
    },
  },
  SAMPLE_REQUEST: {
    async load(companyId, ids, branch) {
      return (await CrmErpRepository.sampleRequestDocs({ companyId, id: { in: ids }, ...branch }, ids.length)).map(sampleView);
    },
    async search(companyId, { customerId, term }, branch, take) {
      return (await CrmErpRepository.sampleRequestDocs({ companyId, ...(customerId ? { customerId } : {}), ...(term ? { OR: [{ requestNumber: contains(term) }, { styleName: contains(term) }] } : {}), ...branch }, take)).map(sampleView);
    },
  },
  SALES_ORDER: {
    async load(companyId, ids, branch) {
      return (await CrmErpRepository.salesOrderDocs({ companyId, id: { in: ids }, ...branch }, ids.length)).map(orderView);
    },
    async search(companyId, { customerId, term }, branch, take) {
      return (await CrmErpRepository.salesOrderDocs({ companyId, ...(customerId ? { customerId } : {}), ...(term ? { OR: [{ orderNumber: contains(term) }, { customerPoNumber: contains(term) }] } : {}), ...branch }, take)).map(orderView);
    },
  },
};

type EnquiryRow = Awaited<ReturnType<typeof CrmErpRepository.buyerEnquiryDocs>>[number];
type SampleRow = Awaited<ReturnType<typeof CrmErpRepository.sampleRequestDocs>>[number];
type OrderRow = Awaited<ReturnType<typeof CrmErpRepository.salesOrderDocs>>[number];
type QuotationRow = Awaited<ReturnType<typeof CrmErpRepository.quotationDocs>>[number];

function quotationView(x: QuotationRow): ErpDocView {
  const r = x.revisions[0];
  return {
    id: x.id,
    number: r && r.revisionNumber > 1 ? `${x.quotationNumber} rev ${r.revisionNumber}` : x.quotationNumber,
    date: r?.quotationDate ?? x.createdAt,
    status: x.status,
    amount: money(r?.grandTotal),
    currencyCode: r?.currencyCode ?? null,
    dueDate: r?.validUntil ?? null,
    subtitle: r?.title ?? null,
    customerId: x.customerId,
    customerName: x.customer?.name ?? (x.prospectName ? `${x.prospectName} (prospect)` : null),
    person: x.owner?.fullName ?? x.createdBy.fullName,
    href: `/sales-marketing/quotations/${x.id}`,
  };
}

function enquiryView(x: EnquiryRow): ErpDocView {
  return {
    id: x.id,
    number: x.enquiryNumber,
    date: x.enquiryDate,
    status: x.status,
    amount: null,
    currencyCode: null,
    dueDate: null,
    subtitle: x.customer ? null : x.prospectName ? `Prospect: ${x.prospectName}` : null,
    customerId: x.customerId,
    customerName: x.customer?.name ?? null,
    person: x.requestedBy.fullName,
    href: `/buyer-enquiries/${x.id}`,
  };
}
function sampleView(x: SampleRow): ErpDocView {
  return { id: x.id, number: x.requestNumber, date: x.requestDate, status: x.status, amount: null, currencyCode: null, dueDate: x.targetSubmissionDate, subtitle: x.styleName, customerId: x.customerId, customerName: x.customer.name, person: x.requestedBy.fullName, href: `/sampling/${x.id}` };
}
function orderView(x: OrderRow): ErpDocView {
  return { id: x.id, number: x.orderNumber, date: x.orderDate, status: x.status, amount: money(x.totalAmount), currencyCode: x.currencyCode, dueDate: x.requiredShipDate, subtitle: null, customerId: x.customerId, customerName: x.customer.name, person: x.requestedBy.fullName, href: `/sales-orders/${x.id}` };
}

async function access(actor: CrmActor) {
  const [branches, ...allowed] = await Promise.all([PermissionService.getAllowedBranchIds(actor.userId), ...ERP_DOC_TYPE_KEYS.map((t) => PermissionService.can(actor.userId, ERP_DOC_TYPES[t].module, "view"))]);
  return { branch: branchScopeWhere(branches), allowed: Object.fromEntries(ERP_DOC_TYPE_KEYS.map((t, i) => [t, Boolean(allowed[i])])) as Record<ErpDocType, boolean> };
}

/** The ERP customer behind the opportunity's company (documents of other customers can't be linked). */
async function opportunityCustomerId(actor: CrmActor, crmCompanyId: string | null) {
  if (!crmCompanyId) return null;
  return (await CrmErpRepository.crmCompany(actor.companyId, crmCompanyId))?.customerId ?? null;
}

/** Linked ERP documents grouped by type, with live ERP data where the viewer may see it. */
export async function listOpportunityErpDocuments(actor: CrmActor, opportunityId: string) {
  const opp = await loadOpportunityForActor(actor, opportunityId);
  const [links, { branch, allowed }, customerId] = await Promise.all([CrmOpportunityRepository.erpLinks(actor.companyId, opportunityId), access(actor), opportunityCustomerId(actor, opp.crmCompanyId)]);
  const sections = await Promise.all(
    ERP_DOC_TYPE_KEYS.map(async (type) => {
      const own = links.filter((l) => l.docType === type);
      const docs = allowed[type] && own.length ? await PROVIDERS[type].load(actor.companyId, own.map((l) => l.docId), branch) : [];
      const byId = new Map(docs.map((d) => [d.id, d]));
      return {
        type,
        label: ERP_DOC_TYPES[type].plural,
        allowed: allowed[type],
        rows: own.map((l) => ({
          linkId: l.id,
          docId: l.docId,
          docNumber: l.docNumber,
          linkedAt: l.createdAt,
          // null: no access (module or branch) or the ERP document no longer exists.
          doc: byId.get(l.docId) ?? null,
        })),
      };
    })
  );
  return {
    customerLinked: Boolean(customerId),
    sections,
    notAvailable: [] as { key: string; label: string; reason: string }[],
    // Links whose type is no longer registered are kept and listed, never dropped silently.
    unknown: links.filter((l) => !(ERP_DOC_TYPE_KEYS as readonly string[]).includes(l.docType)).map((l) => ({ linkId: l.id, docType: l.docType, docNumber: l.docNumber })),
  };
}

/** ERP documents the user may link: their customer's documents (or a number search when the company has no ERP customer). */
export async function searchLinkableErpDocuments(actor: CrmActor, opportunityId: string, raw: unknown) {
  const input = erpDocumentSearchSchema.parse(raw);
  const opp = await loadOpportunityForActor(actor, opportunityId);
  const { branch, allowed } = await access(actor);
  if (!allowed[input.docType]) throw new BusinessRuleError("PERMISSION_DENIED", `You don't have access to ${ERP_DOC_TYPES[input.docType].plural.toLowerCase()}.`);
  const customerId = await opportunityCustomerId(actor, opp.crmCompanyId);
  if (!customerId && (input.search ?? "").length < 2) return { customerLinked: false, rows: [] };
  const [rows, links] = await Promise.all([PROVIDERS[input.docType].search(actor.companyId, { customerId, term: input.search }, branch, input.limit), CrmOpportunityRepository.erpLinks(actor.companyId, opportunityId)]);
  const linked = new Set(links.filter((l) => l.docType === input.docType).map((l) => l.docId));
  return { customerLinked: Boolean(customerId), rows: rows.map((r) => ({ ...r, alreadyLinked: linked.has(r.id) })) };
}

/**
 * Links an existing ERP document: the user needs that ERP module's view
 * permission and branch access; the document must belong to the
 * opportunity's ERP customer when the company is linked to one.
 */
export async function linkErpDocument(actor: CrmActor, opportunityId: string, raw: unknown) {
  const input = linkErpDocumentSchema.parse(raw);
  const opp = await loadEditableOpportunity(actor, opportunityId, "linking ERP documents", { allowClosed: true });
  const { branch, allowed } = await access(actor);
  const meta = ERP_DOC_TYPES[input.docType];
  if (!allowed[input.docType]) throw new BusinessRuleError("PERMISSION_DENIED", `You don't have access to ${meta.plural.toLowerCase()}.`);
  const [doc] = await PROVIDERS[input.docType].load(actor.companyId, [input.docId], branch);
  if (!doc) throw new BusinessRuleError("NOT_FOUND", `${meta.label} not found.`, { id: input.docId });
  const customerId = await opportunityCustomerId(actor, opp.crmCompanyId);
  if (customerId && doc.customerId && doc.customerId !== customerId) {
    throw new BusinessRuleError("VALIDATION_ERROR", `${meta.label} ${doc.number} belongs to another customer (${doc.customerName ?? "unknown"}).`, { fieldErrors: { docId: "Choose a document of this opportunity's customer." } });
  }
  if (await CrmOpportunityRepository.findErpLinkByDoc(opportunityId, input.docType, input.docId)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${meta.label} ${doc.number} is already linked.`);
  return runCrmMutation(actor, async (ctx) => {
    const link = await ctx.tx.crmOpportunityErpLink.create({ data: { companyId: actor.companyId, opportunityId, docType: input.docType, docId: doc.id, docNumber: doc.number, linkedByUserId: actor.userId } });
    await refreshOpportunitySearchText(ctx, opportunityId);
    await ctx.audit({ tableName: "crm_opportunity_erp_links", recordId: link.id, action: "CREATE", newValues: link });
    ctx.emit({ entityType: "OPPORTUNITY", entityId: opportunityId, eventType: "opportunity.erp_document_linked", summary: `${meta.label} ${doc.number}`, payload: { linkId: link.id, docType: input.docType, docId: doc.id, docNumber: doc.number } });
    return link;
  });
}

export async function unlinkErpDocument(actor: CrmActor, opportunityId: string, linkId: string) {
  await loadEditableOpportunity(actor, opportunityId, "changing its ERP documents", { allowClosed: true });
  const link = await CrmOpportunityRepository.findErpLink(actor.companyId, opportunityId, linkId);
  if (!link) throw new BusinessRuleError("NOT_FOUND", "This ERP document is not linked to the opportunity.", { id: linkId });
  const label = ERP_DOC_TYPES[link.docType as ErpDocType]?.label ?? link.docType;
  await runCrmMutation(actor, async (ctx) => {
    await ctx.tx.crmOpportunityErpLink.delete({ where: { id: link.id } });
    await refreshOpportunitySearchText(ctx, opportunityId);
    await ctx.audit({ tableName: "crm_opportunity_erp_links", recordId: link.id, action: "DELETE", oldValues: link });
    ctx.emit({ entityType: "OPPORTUNITY", entityId: opportunityId, eventType: "opportunity.erp_document_unlinked", summary: `${label} ${link.docNumber}`, payload: { docType: link.docType, docId: link.docId, docNumber: link.docNumber } });
  });
}
