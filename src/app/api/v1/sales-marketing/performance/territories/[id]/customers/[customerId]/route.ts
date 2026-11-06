import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { removeCustomer } from "@/modules/sales-marketing/performance/territory.service";

/** DELETE: take the customer out of this territory. */
export const DELETE = salesMarketingRoute<{ id: string; customerId: string }>({ module: "sales_performance", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await removeCustomer(actor, params.id, params.customerId) })
);
