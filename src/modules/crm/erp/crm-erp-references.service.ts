import { z } from "zod";
import type { Module } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import type { CrmActor } from "../core/crm-actor";
import { CrmErpRepository } from "./crm-erp.repository";

/**
 * Read-only references from the CRM to authoritative ERP documents of one
 * ERP customer (used by CRM companies and contacts). Each section is loaded
 * only when the viewer has that ERP module's view permission, follows their
 * branch access, and is paged — the CRM never copies ERP transactions.
 *
 * Quotations and support tickets are listed as "not available": the ERP has
 * no such modules. When one is added, register a section here.
 */

export const ERP_SECTIONS = ["buyerEnquiries", "salesOrders", "salesInvoices", "receipts"] as const;
export type ErpSectionKey = (typeof ERP_SECTIONS)[number];

export const erpReferenceQuerySchema = z.object({
  section: z.enum(ERP_SECTIONS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
export type ErpReferenceQuery = z.infer<typeof erpReferenceQuerySchema>;

const SECTION_META: Record<ErpSectionKey, { label: string; module: Module }> = {
  buyerEnquiries: { label: "Buyer enquiries", module: "buyer_enquiries" },
  salesOrders: { label: "Sales orders", module: "sales_orders" },
  salesInvoices: { label: "Sales invoices", module: "invoices" },
  receipts: { label: "Payments received", module: "payments" },
};

export interface ErpReferenceRow {
  id: string;
  number: string;
  date: Date;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  /** Invoice: still to be paid; null elsewhere. */
  outstanding: string | null;
  dueDate: Date | null;
  person: string | null;
  href: string;
}

const money = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function loadSection(key: ErpSectionKey, companyId: string, customerId: string, branch: ReturnType<typeof branchScopeWhere>, page: { skip: number; take: number }): Promise<{ rows: ErpReferenceRow[]; total: number }> {
  if (key === "buyerEnquiries") {
    const r = await CrmErpRepository.buyerEnquiries(companyId, customerId, branch, page);
    return { total: r.total, rows: r.rows.map((x) => ({ id: x.id, number: x.enquiryNumber, date: x.enquiryDate, status: x.status, amount: null, currencyCode: null, outstanding: null, dueDate: null, person: x.requestedBy.fullName, href: `/buyer-enquiries/${x.id}` })) };
  }
  if (key === "salesOrders") {
    const r = await CrmErpRepository.salesOrders(companyId, customerId, branch, page);
    return { total: r.total, rows: r.rows.map((x) => ({ id: x.id, number: x.orderNumber, date: x.orderDate, status: x.status, amount: money(x.totalAmount), currencyCode: x.currencyCode, outstanding: null, dueDate: null, person: x.requestedBy.fullName, href: `/sales-orders/${x.id}` })) };
  }
  if (key === "salesInvoices") {
    const r = await CrmErpRepository.salesInvoices(companyId, customerId, branch, page);
    return {
      total: r.total,
      rows: r.rows.map((x) => ({
        id: x.id,
        number: x.invoiceNumber,
        date: x.invoiceDate,
        status: x.status,
        amount: money(x.totalAmount),
        currencyCode: x.currencyCode,
        outstanding: money(Number(x.totalAmount) - Number(x.paidAmount)),
        dueDate: x.dueDate,
        person: null,
        href: `/accounts/sales-invoices/${x.id}`,
      })),
    };
  }
  const r = await CrmErpRepository.receipts(companyId, customerId, branch, page);
  return { total: r.total, rows: r.rows.map((x) => ({ id: x.id, number: x.paymentNumber, date: x.paymentDate, status: x.status, amount: money(x.amount), currencyCode: x.currencyCode, outstanding: null, dueDate: null, person: null, href: `/accounts/payments/${x.id}` })) };
}

/** ERP customer summary + paged ERP sections for one customer. */
export async function getErpReferencesForCustomer(actor: CrmActor, customerId: string, query: ErpReferenceQuery = { page: 1, pageSize: 10 }) {
  const keys = query.section ? [query.section] : [...ERP_SECTIONS];
  const [mastersView, allowedBranches, ...allowed] = await Promise.all([
    PermissionService.can(actor.userId, "masters_core", "view"),
    PermissionService.getAllowedBranchIds(actor.userId),
    ...keys.map((k) => PermissionService.can(actor.userId, SECTION_META[k].module, "view")),
  ]);
  const branch = branchScopeWhere(allowedBranches);
  const page = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
  const [customer, ...loaded] = await Promise.all([
    CrmErpRepository.customer(actor.companyId, customerId),
    ...keys.map((k, i) => (allowed[i] ? loadSection(k, actor.companyId, customerId, branch, page) : Promise.resolve(null))),
  ]);
  return {
    customer: customer
      ? {
          id: customer.id,
          code: customer.code,
          name: customer.name,
          type: customer.type,
          city: customer.city,
          country: customer.country,
          status: customer.deletedAt ? "DELETED" : customer.isActive ? "ACTIVE" : "INACTIVE",
          href: mastersView && !customer.deletedAt ? `/masters/customers/${customer.id}` : null,
        }
      : null,
    sections: keys.map((k, i) => ({ key: k, label: SECTION_META[k].label, allowed: Boolean(allowed[i]), total: loaded[i]?.total ?? 0, rows: loaded[i]?.rows ?? [], page: query.page, pageSize: query.pageSize })),
    notAvailable: [
      { key: "quotations", label: "Quotations", reason: "Quotations aren't listed here yet — see Sales & Marketing → Quotations, or link them on an opportunity." },
      { key: "tickets", label: "Support tickets", reason: "The ERP has no support / ticket module yet." },
    ],
  };
}

/** ERP references for a CRM company (via its ERP customer link), or why there are none. */
export async function getErpReferencesForCrmCompany(actor: CrmActor, crmCompanyId: string | null, query?: ErpReferenceQuery, subject: "contact" | "company" = "company") {
  const crmCompany = crmCompanyId ? await CrmErpRepository.crmCompany(actor.companyId, crmCompanyId) : null;
  const company = crmCompany ? { id: crmCompany.id, name: crmCompany.name } : null;
  if (!crmCompany?.customerId) {
    return {
      linked: false as const,
      crmCompany: company,
      reason:
        subject === "company"
          ? "This company is not linked to an ERP customer. Use “Link ERP customer” to connect an existing customer."
          : company
            ? "This contact's company is not linked to an ERP customer yet."
            : "This contact has no company. Pick an ERP customer as the company to see its ERP documents.",
    };
  }
  return { linked: true as const, crmCompany: company, ...(await getErpReferencesForCustomer(actor, crmCompany.customerId, query)) };
}
