import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { enquiryImportTemplate } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — enquiry import template (?format=csv|xlsx): the exact columns validation reads, one sample row. */
export const GET = salesMarketingRoute("create", async ({ req }) => {
  const t = await enquiryImportTemplate(req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx");
  return new NextResponse(new Uint8Array(t.buffer), { headers: { "Content-Type": t.mimeType, "Content-Disposition": `attachment; filename="${t.fileName}"`, "Cache-Control": "no-store" } });
});
