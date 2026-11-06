import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { workflowMetrics } from "@/modules/sales-marketing/workflows/sm-workflows.service";

/** Phase 15 — operational metrics: running / waiting / attention, completion rate, approval wait, retries, lag. */
export const GET = salesMarketingRoute({ module: "sales_workflows", action: "view" }, async ({ actor }) => NextResponse.json({ data: await workflowMetrics(actor) }));
