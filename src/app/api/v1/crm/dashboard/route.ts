import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCrmDashboard, parseDashboardQuery } from "@/modules/crm/dashboard/crm-dashboard.service";

/**
 * Phase 21 — CRM dashboard data, one request for every visible widget.
 *   GET ?range=today|7d|30d|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *       &pipelineId=&owner=all|me|<userId>&widgets=kpis,pipeline,leads,attention,myWork,activity,automation
 * → { generatedAt, timeZone, filters, viewer, widgets: { <key>: { status: "ok", data } | { status: "error", message } } }
 * Record visibility is applied per widget on the server; another owner needs crm.view_all;
 * workflow / integration health needs crm_settings.view.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const data = await getCrmDashboard(actor, parseDashboardQuery(req.nextUrl.searchParams));
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store, private" } });
});
