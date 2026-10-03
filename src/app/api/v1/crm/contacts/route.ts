import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { contactSortSchema, parseContactFilterParams } from "@/modules/crm/contacts/contact.schema";
import { createContact, listContacts } from "@/modules/crm/contacts/crm-contacts.service";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET: server-side search, filters, sort and paging (query format: see
 * parseContactFilterParams). Archived contacts are excluded unless
 * `archived=only|include`; merged contacts are never listed.
 * POST: create a contact (409 CRM_POSSIBLE_DUPLICATE for warnings — resend
 * with `confirmDuplicate: true`; 409 CRM_DUPLICATE_RECORD when a BLOCK rule matches).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseContactFilterParams(sp);
  const sort = contactSortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listContacts(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createContact(actor, await req.json()) }, { status: 201 }));
