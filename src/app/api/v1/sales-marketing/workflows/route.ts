import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listDefinitions } from "@/modules/sales-marketing/workflows/sm-workflows.service";

/** Phase 15 — the registered S&M workflows of this company (status, version, run-as, live / attention counts). */
export const GET = salesMarketingRoute({ module: "sales_workflows", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listDefinitions(actor) }));
