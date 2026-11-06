import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getRun } from "@/modules/sales-marketing/attribution/attribution-report.service";

/** GET: a run's counts, data-quality summary and changes since its data cut. */
export const GET = salesMarketingRoute<{ runId: string }>({ module: "marketing_attribution", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getRun(actor, params.runId) }));
