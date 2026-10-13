import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { rejectSchema } from "@/modules/support-access/support-access.schema";
import { rejectWriteAccess } from "@/modules/support-access/support-access.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    const { reason } = rejectSchema.parse(await req.json().catch(() => ({})));
    await rejectWriteAccess(actor, id, reason);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Write access rejected." } });
  } catch (error) {
    return handleApiError(error);
  }
}
