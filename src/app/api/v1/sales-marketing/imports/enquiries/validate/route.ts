import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { validateEnquiryImport } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — validation preview (multipart `file`): every row through the real checks; nothing is written. */
export const POST = salesMarketingRoute("create", async ({ req, actor }) => NextResponse.json({ data: await validateEnquiryImport(actor, await req.formData()) }));
