import { NextResponse } from "next/server";
import { resolveConflict } from "@/modules/sales-marketing/integrations/enquiry-intake.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** POST { action: keep_erp | apply_external | dismiss, note? } — sales_integrations.approve. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_integrations", action: "approve" }, async ({ req, actor, params }) => NextResponse.json({ data: await resolveConflict(actor, params.id, await req.json()) }));
