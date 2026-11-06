import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveSavedReport, getSavedReport, updateSavedReport } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };

/** Phase 17 — GET / PATCH (owner; optimistic version) / DELETE ?version= (owner; soft delete) one saved report. */
export const GET = salesMarketingRoute<P>({ module: "sales_analytics", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getSavedReport(actor, params.id) }));
export const PATCH = salesMarketingRoute<P>({ module: "sales_analytics", action: "create" }, async ({ req, actor, params }) => NextResponse.json({ data: await updateSavedReport(actor, params.id, await req.json()) }));
export const DELETE = salesMarketingRoute<P>({ module: "sales_analytics", action: "create" }, async ({ req, actor, params }) => {
  const version = z.coerce.number().int().parse(req.nextUrl.searchParams.get("version"));
  return NextResponse.json({ data: await archiveSavedReport(actor, params.id, version) });
});
