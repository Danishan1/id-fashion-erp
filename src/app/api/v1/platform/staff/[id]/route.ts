import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { updatePlatformStaff } from "@/modules/platform/platform-staff.service";

const updateStaffSchema = z.object({
  fullName: z.string().min(2).optional(),
  role: z.enum(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT", "BILLING_ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const body = await req.json();
    const input = updateStaffSchema.parse(body);

    const updated = await updatePlatformStaff({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json(
      { data: updated },
      { headers: { "x-toast-success": `Operator ${updated.fullName} updated.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
