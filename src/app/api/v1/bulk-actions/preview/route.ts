import { NextResponse } from "next/server";
import { previewBulkJob } from "@/modules/bulk-actions/bulk-jobs.service";
import { bulkRoute, readJsonBody } from "@/modules/bulk-actions/bulk-route";

/**
 * Phase 14. POST { entityType, actionKey, selection, params } → how many records
 * the job would process, the parameter summary, warnings, the confirmation
 * required and a few sample record names. Changes nothing.
 */
export const POST = bulkRoute(async ({ req, actor }) => NextResponse.json({ data: await previewBulkJob(actor, await readJsonBody(req)) }));
