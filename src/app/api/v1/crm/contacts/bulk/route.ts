import { NextResponse } from "next/server";
import { bulkContactAction } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { action: "assign" | "addTags" | "removeTags" | "archive", ids: [...≤500], ... }. Returns { requested, updated, skipped[] }. */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await bulkContactAction(actor, await req.json()) }));
