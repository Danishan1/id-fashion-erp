import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { calculateStatements } from "@/modules/sales-marketing/commissions/commission-statement.service";

/** POST { month: "YYYY-MM" }: calculate / recalculate every payee's draft statement for the month. */
export const POST = salesMarketingRoute({ module: "sales_commissions", action: "create" }, async ({ req, actor }) => NextResponse.json({ data: await calculateStatements(actor, await req.json()) }));
