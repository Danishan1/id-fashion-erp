import { NextResponse } from "next/server";
import { searchCrmContacts } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Contact lookup for linking pickers (active, unmerged contacts visible to the caller). ?search=, ?limit= (≤200, default 20). */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || 20));
  return NextResponse.json({ data: await searchCrmContacts(actor, sp.get("search") ?? undefined, limit) });
});
