import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { endAssignment, removeAssignment } from "@/modules/sales-marketing/commissions/commission-plan.service";

type P = { id: string; assignmentId: string };

/** PATCH { endDate }: end an assignment (earlier only). */
export const PATCH = salesMarketingRoute<P>({ module: "sales_commissions", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await endAssignment(actor, params.id, params.assignmentId, await req.json()) }));

/** DELETE: remove an assignment that hasn't started. */
export const DELETE = salesMarketingRoute<P>({ module: "sales_commissions", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await removeAssignment(actor, params.id, params.assignmentId) }));
