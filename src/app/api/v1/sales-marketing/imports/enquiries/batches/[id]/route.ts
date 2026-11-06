import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getEnquiryImportBatch } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — one import: status, progress, counts and the first failed rows. */
export const GET = salesMarketingRoute<{ id: string }>("create", async ({ actor, params }) => NextResponse.json({ data: await getEnquiryImportBatch(actor, params.id) }));
