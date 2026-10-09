import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { linkErpCustomer, unlinkErpCustomer } from "@/modules/crm/companies/crm-companies.service";

/**
 * POST { customerId, confirmDuplicate? }: link an existing ERP customer (validated: exists, not deleted,
 * caller can view customers, not linked to another CRM company). DELETE: remove the reference only.
 * The ERP customer itself is never created, edited, merged or deleted from the CRM.
 */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await linkErpCustomer(actor, params.id, await req.json()) }));

export const DELETE = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await unlinkErpCustomer(actor, params.id) }));
