import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { testConnection } from "@/modules/sales-marketing/delivery/connection.service";

/** POST: checks the credentials with the provider (sends no message). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await testConnection(actor, params.id) });
});
