import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPlan, updatePlanHeader } from "@/modules/sales-marketing/commissions/commission-plan.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "sales_commissions", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getPlan(actor, params.id) }));

export const PATCH = salesMarketingRoute<P>({ module: "sales_commissions", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await updatePlanHeader(actor, params.id, await req.json()) }));
