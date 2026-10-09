import { NextResponse } from "next/server";
import { searchCrmCompanies, searchCustomersForLinking } from "@/modules/crm/companies/crm-companies.service";
import { canLinkCustomers } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Company picker for the contact form: CRM companies the user can see, plus
 * ERP customers (only for users who can view customers). Picking a customer
 * links the contact to the CRM company that references it.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const [companies, customers] = await Promise.all([searchCrmCompanies(actor, search, 200), (await canLinkCustomers(actor)) ? searchCustomersForLinking(actor, search, 200) : Promise.resolve(null)]);
  return NextResponse.json({ data: { companies, customers } });
});
