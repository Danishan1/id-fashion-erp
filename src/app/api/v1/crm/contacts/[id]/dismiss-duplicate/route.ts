import { NextResponse } from "next/server";
import { dismissDuplicateFlag } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** "Not a duplicate": clears the possible-duplicate flag left by a FLAG rule. */
export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await dismissDuplicateFlag(actor, params.id) }));
