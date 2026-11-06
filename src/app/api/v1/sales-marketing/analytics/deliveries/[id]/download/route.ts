import { NextResponse } from "next/server";
import { downloadDelivery } from "@/modules/sales-marketing/analytics/analytics-delivery.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };

/** Phase 17 — GET your delivered report file (recipient only, until it expires; audited). */
export const GET = salesMarketingRoute<P>({ module: "sales_analytics", action: "view" }, async ({ actor, params }) => {
  const f = await downloadDelivery(actor, params.id);
  return new NextResponse(new Uint8Array(f.buffer), {
    status: 200,
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(f.buffer.byteLength),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
