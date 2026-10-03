import { prisma } from "@/core/db/client";

type BranchScope = { branchId?: { in: string[] } };

/**
 * Read-only queries against authoritative ERP documents for a contact's
 * customer. The CRM never writes these tables and never copies their data.
 */
export const ContactErpRepository = {
  crmCompany(companyId: string, crmCompanyId: string) {
    return prisma.crmCompany.findFirst({ where: { id: crmCompanyId, companyId }, select: { id: true, name: true, customerId: true } });
  },
  customer(companyId: string, customerId: string) {
    return prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true, code: true, name: true, type: true, country: true, city: true } });
  },
  async buyerEnquiries(companyId: string, customerId: string, branch: BranchScope, take: number) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.buyerEnquiry.findMany({ where, select: { id: true, enquiryNumber: true, enquiryDate: true, status: true }, orderBy: { enquiryDate: "desc" }, take }),
      prisma.buyerEnquiry.count({ where }),
    ]);
    return { rows, total };
  },
  async salesOrders(companyId: string, customerId: string, branch: BranchScope, take: number) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.salesOrder.findMany({ where, select: { id: true, orderNumber: true, orderDate: true, status: true, totalAmount: true, currencyCode: true }, orderBy: { orderDate: "desc" }, take }),
      prisma.salesOrder.count({ where }),
    ]);
    return { rows, total };
  },
  async salesInvoices(companyId: string, customerId: string, branch: BranchScope, take: number) {
    const where = { companyId, customerId, ...branch };
    const [rows, total] = await Promise.all([
      prisma.salesInvoice.findMany({ where, select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, status: true, totalAmount: true, paidAmount: true, currencyCode: true }, orderBy: { invoiceDate: "desc" }, take }),
      prisma.salesInvoice.count({ where }),
    ]);
    return { rows, total };
  },
  async receipts(companyId: string, customerId: string, branch: BranchScope, take: number) {
    const where = { companyId, customerId, direction: "RECEIPT" as const, ...branch };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, select: { id: true, paymentNumber: true, paymentDate: true, status: true, amount: true, currencyCode: true, referenceNumber: true }, orderBy: { paymentDate: "desc" }, take }),
      prisma.payment.count({ where }),
    ]);
    return { rows, total };
  },
};
