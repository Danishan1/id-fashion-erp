import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getPreferences } from "@/modules/crm/preferences/crm-preferences.service";

/** The signed-in user's CRM screen preferences; ?prefix=opportunities. narrows them. */
export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await getPreferences(actor, req.nextUrl.searchParams.get("prefix") ?? "") }));
