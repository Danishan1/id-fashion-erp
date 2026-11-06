import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getStatement } from "@/modules/sales-marketing/commissions/commission-statement.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_commissions", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getStatement(actor, params.id) }));
