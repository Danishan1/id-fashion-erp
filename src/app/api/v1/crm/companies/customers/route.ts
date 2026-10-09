import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { canLinkCustomers, searchCustomersForLinking } from "@/modules/crm/companies/crm-companies.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * ERP customers for the "Link ERP customer" picker (?search=, ≤50). Identity
 * fields only — never balances or transactions. Requires access to customers
 * (masters or sales view) on top of crm.view.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  if (!(await canLinkCustomers(actor))) throw new BusinessRuleError("PERMISSION_DENIED", "You don't have access to ERP customers.");
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await searchCustomersForLinking(actor, sp.get("search") ?? undefined, Math.min(50, Math.max(1, Number(sp.get("limit")) || 20))) });
});
