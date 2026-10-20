import { NextResponse } from "next/server";
import { getBulkCapabilities } from "@/modules/bulk-actions/bulk-jobs.service";
import { bulkRoute } from "@/modules/bulk-actions/bulk-route";

/**
 * Phase 14. GET ?entityType=LEAD → { entity, actions[] }: every bulk action for
 * the record type with its availability for this user (and the reason when
 * unavailable) and its parameter fields (options resolved for this user).
 */
export const GET = bulkRoute(async ({ req, actor }) => {
  const entityType = req.nextUrl.searchParams.get("entityType")?.trim() ?? "";
  return NextResponse.json({ data: await getBulkCapabilities(actor, entityType) });
});
