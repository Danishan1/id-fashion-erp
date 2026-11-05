import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listStatements } from "@/modules/sales-marketing/commissions/commission-statement.service";

export const GET = salesMarketingRoute({ module: "sales_commissions", action: "view" }, async ({ req, actor }) => NextResponse.json({ data: await listStatements(actor, Object.fromEntries(req.nextUrl.searchParams)) }));
