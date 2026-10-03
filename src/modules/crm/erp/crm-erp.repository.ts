import { prisma } from "@/core/db/client";

type BranchScope = { branchId?: { in: string[] } };
type Page = { skip: number; take: number };

/**
 * Read-only queries against authoritative ERP documents of one ERP customer
 * (for CRM companies and contacts). The CRM never writes these tables and
 * never copies their data.
 */
export const CrmErpRepository = {
  crmCompany(companyId: string, crmCompanyId: string) {
    return prisma.crmCompany.findFirst({ where: { id: crmCompanyId, companyId }, select: { id: true, name: true, customerId: true } });
  },
  customer(companyId: string, customerId: string) {
    return prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, code: true, name: true, type: true, country: true, city: true, isActive: true, deletedAt: true } });
  },
  async buyerEnquiries(companyId: string, customerId: string, branch: BranchScope, page: Page) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.buyerEnquiry.findMany({ where, select: { id: true, enquiryNumber: true, enquiryDate: true, status: true, requestedBy: { select: { fullName: true } } }, orderBy: [{ enquiryDate: "desc" }, { id: "desc" }], ...page }),
      prisma.buyerEnquiry.count({ where }),
    ]);
    return { rows, total };
  },
  async salesOrders(companyId: string, customerId: string, branch: BranchScope, page: Page) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        select: { id: true, orderNumber: true, orderDate: true, status: true, totalAmount: true, currencyCode: true, requestedBy: { select: { fullName: true } } },
        orderBy: [{ orderDate: "desc" }, { id: "desc" }],
        ...page,
      }),
      prisma.salesOrder.count({ where }),
    ]);
    return { rows, total };
  },
  async salesInvoices(companyId: string, customerId: string, branch: BranchScope, page: Page) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true, totalAmount: true, paidAmount: true, currencyCode: true },
        orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
        ...page,
      }),
      prisma.salesInvoice.count({ where }),
    ]);
    return { rows, total };
  },
  async receipts(companyId: string, customerId: string, branch: BranchScope, page: Page) {
    const where = { companyId, customerId, direction: "RECEIPT" as const, ...branch };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, select: { id: true, paymentNumber: true, paymentDate: true, status: true, amount: true, currencyCode: true, referenceNumber: true }, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], ...page }),
      prisma.payment.count({ where }),
    ]);
    return { rows, total };
  },
};
