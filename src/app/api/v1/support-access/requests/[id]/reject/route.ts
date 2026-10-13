import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { rejectSchema } from "@/modules/support-access/support-access.schema";
import { rejectSupportRequest } from "@/modules/support-access/support-access.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    const { reason } = rejectSchema.parse(await req.json().catch(() => ({})));
    await rejectSupportRequest(actor, id, reason);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Support request rejected." } });
  } catch (error) {
    return handleApiError(error);
  }
}
