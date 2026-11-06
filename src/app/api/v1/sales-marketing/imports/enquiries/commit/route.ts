import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { commitEnquiryImport } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — import (multipart `file`): re-checked from scratch, then queued; rows are created in the background. */
export const POST = salesMarketingRoute("create", async ({ req, actor }) => NextResponse.json({ data: await commitEnquiryImport(actor, await req.formData()) }, { status: 202 }));
