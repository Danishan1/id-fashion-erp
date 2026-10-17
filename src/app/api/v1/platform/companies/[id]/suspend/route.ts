import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { suspendCompanySchema } from "@/modules/platform/platform-company-lifecycle.schema";
import { suspendCompany } from "@/modules/platform/platform-company-lifecycle.service";

/** PLAT-016: suspend a company — its users lose access on their next request. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const { reason } = suspendCompanySchema.parse(await req.json());
    await suspendCompany({ platformUserId: platformUser.id }, id, reason);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Company suspended." } });
  } catch (error) {
    return handleApiError(error);
  }
}
