import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { removeAdjustment } from "@/modules/sales-marketing/commissions/commission-statement.service";

export const DELETE = salesMarketingRoute<{ id: string; lineId: string }>({ module: "sales_commissions", action: "create" }, async ({ actor, params }) => NextResponse.json({ data: await removeAdjustment(actor, params.id, params.lineId) }));
