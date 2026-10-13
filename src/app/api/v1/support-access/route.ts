import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { listCompanySupportAccess } from "@/modules/support-access/support-access.service";

export async function GET() {
  try {
    const actor = await requireTenantSupportActor();
    return NextResponse.json({ data: await listCompanySupportAccess(actor) });
  } catch (error) {
    return handleApiError(error);
  }
}
