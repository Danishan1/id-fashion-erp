import { NextResponse } from "next/server";
import { PermissionService } from "@/core/rbac/PermissionService";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { convertLead, getConversionSuggestions } from "@/modules/crm/leads/lead.service";

/** GET: existing companies/contacts that match this lead, shown before converting. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getConversionSuggestions(actor, params.id) }));

/** POST: convert (creates or links Company / Contact, optionally an Opportunity). Needs crm.edit and crm.create. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  await PermissionService.assert(actor.userId, "crm", "create");
  return NextResponse.json({ data: await convertLead(actor, params.id, await req.json()) });
});
