import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getSettingsOverview } from "@/modules/crm/settings/crm-integrations-overview.service";

/** Phase 22 — Settings overview + integrations catalogue (statuses computed from real configuration; no secrets). */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await getSettingsOverview(actor) }));
