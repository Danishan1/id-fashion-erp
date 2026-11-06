import { NextResponse } from "next/server";
import { exportReport } from "@/modules/sales-marketing/analytics/analytics.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — POST { query, title, format: CSV|XLSX } → the report file (bounded, formula-safe, with a header block). */
export const POST = salesMarketingRoute({ module: "sales_analytics", action: "export" }, async ({ req, actor }) => {
  const f = await exportReport(actor, await req.json());
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
