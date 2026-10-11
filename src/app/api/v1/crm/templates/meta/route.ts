import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { templateMeta } from "@/modules/crm/templates/crm-templates.service";

/** Channels, statuses, merge fields (grouped by record), categories and channels a test can be sent through. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await templateMeta(actor) }));
