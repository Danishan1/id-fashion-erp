import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { reviewIngestEvent } from "@/modules/crm/capture/crm-ingest-events.service";

/** Decide a flagged submission. Body: { action: "CREATE" | "UPDATE" | "SKIP", leadId? }. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await reviewIngestEvent(actor, params.id, await req.json()) }));
