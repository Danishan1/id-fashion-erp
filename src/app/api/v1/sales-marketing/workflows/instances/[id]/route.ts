import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getInstance, instanceAction } from "@/modules/sales-marketing/workflows/sm-workflows.service";

/**
 * Phase 15 — one workflow instance: status, plan, step history, tasks, references.
 *   POST { action: "retry" | "resolve" | "cancel" | "retry_processing", note? }   (sales_workflows.approve)
 */
type P = { id: string };
export const GET = salesMarketingRoute<P>({ module: "sales_workflows", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getInstance(actor, params.id) }));
export const POST = salesMarketingRoute<P>({ module: "sales_workflows", action: "approve" }, async ({ req, actor, params }) => NextResponse.json({ data: await instanceAction(actor, params.id, await req.json()) }));
