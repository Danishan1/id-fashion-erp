import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getLeadBoard } from "@/modules/crm/leads/lead-board.service";

/**
 * GET: lead board — one column per lead status, with the lead list's filters
 * (same query params), `perStatus` cards per column and `statusId` + `offset`
 * to load the next page of one column.
 */
export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await getLeadBoard(actor, Object.fromEntries(req.nextUrl.searchParams)) }));
