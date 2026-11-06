import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { enquiryImportErrorReport } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — CSV of the failed rows (their values + the reason), formula-safe. */
export const GET = salesMarketingRoute<{ id: string }>("create", async ({ actor, params }) => {
  const r = await enquiryImportErrorReport(actor, params.id);
  return new NextResponse(new Uint8Array(r.buffer), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.fileName.replace(/[^\w.-]/g, "_")}"`, "Cache-Control": "no-store, private" } });
});
