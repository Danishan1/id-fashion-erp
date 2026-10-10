import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { convertOpportunityToCustomer } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { mode: "LINK", customerId, confirmDuplicate? } | { mode: "CREATE", code?, name, type?, country?, confirmDuplicate? } — only legal on a Won opportunity. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) =>
  NextResponse.json({ data: await convertOpportunityToCustomer(actor, params.id, await req.json()) })
);
