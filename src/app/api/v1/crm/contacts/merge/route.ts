import { NextResponse } from "next/server";
import { mergeContacts } from "@/modules/crm/contacts/contact-merge.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Body: { survivorId, mergedId, fieldChoices?, customFieldChoices?, survivorVersion, mergedVersion }.
 * The merged contact is archived and points at the survivor; nothing is deleted.
 */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await mergeContacts(actor, await req.json()) }));
