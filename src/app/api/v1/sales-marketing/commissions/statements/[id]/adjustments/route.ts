import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addAdjustment } from "@/modules/sales-marketing/commissions/commission-statement.service";

export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_commissions", action: "create" }, async ({ req, actor, params }) => NextResponse.json({ data: await addAdjustment(actor, params.id, await req.json()) }, { status: 201 }));
