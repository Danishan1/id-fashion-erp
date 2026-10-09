import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { CustomerRepository } from "./customer.repository";

/**
 * Read-only cross-module summary for one customer: buyers, recent sample
 * requests and recent sales orders. A 360 view inherently crosses vertical
 * slices, so it reads SampleRequest/SalesOrder directly rather than adding a
 * repository indirection for one screen.
 *
 * CRM/Marketing sections (leads, deals, activities, follow-ups, campaign
 * touchpoints) were removed with the old CRM and Marketing modules
 * (2026-10-01) and will return with the rebuilt modules.
 */
export async function getCustomer360(companyId: string, customerId: string) {
  const customer = await CustomerRepository.findByIdWithBuyers(companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });

  const [sampleRequests, salesOrders] = await Promise.all([
    prisma.sampleRequest.findMany({
      where: { companyId, customerId },
      select: { id: true, requestNumber: true, styleName: true, status: true, requestDate: true },
      orderBy: { requestDate: "desc" },
      take: 20,
    }),
    prisma.salesOrder.findMany({
      where: { companyId, customerId },
      select: { id: true, orderNumber: true, status: true, orderDate: true, totalAmount: true, currencyCode: true },
      orderBy: { orderDate: "desc" },
      take: 20,
    }),
  ]);

  return { customer, sampleRequests, salesOrders };
}
