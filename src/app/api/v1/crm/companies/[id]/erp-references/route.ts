import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCompanyErpReferences } from "@/modules/crm/companies/company-relations.service";
import { erpReferenceQuerySchema } from "@/modules/crm/erp/crm-erp-references.service";

/**
 * Read-only ERP documents of the linked customer: buyer enquiries, sales orders, sales invoices,
 * receipts — each only with that ERP module's view permission and the caller's branch access.
 * ?section=<key>&page=&pageSize= pages one section.
 */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => {
  const query = erpReferenceQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ data: await getCompanyErpReferences(actor, params.id, query) });
});
