import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { retryIngestEventNow } from "@/modules/crm/capture/crm-ingest-events.service";

export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ params, actor }) => NextResponse.json({ data: await retryIngestEventNow(actor, params.id) }));
