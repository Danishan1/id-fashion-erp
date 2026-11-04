import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createPlan, listPlans } from "@/modules/sales-marketing/commissions/commission-plan.service";

export const GET = salesMarketingRoute({ module: "sales_commissions", action: "view" }, async ({ req, actor }) => NextResponse.json({ data: await listPlans(actor, Object.fromEntries(req.nextUrl.searchParams)) }));

export const POST = salesMarketingRoute({ module: "sales_commissions", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createPlan(actor, await req.json()) }, { status: 201 }));
