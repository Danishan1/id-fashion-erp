import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getIngestEvent } from "@/modules/crm/capture/crm-ingest-events.service";

/** One submission with its received payload (secrets redacted) and mapped fields. */
export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await getIngestEvent(actor, params.id) }));
