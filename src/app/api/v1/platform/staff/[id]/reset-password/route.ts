import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { resetPlatformStaffPassword } from "@/modules/platform/platform-staff.service";

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters long."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const body = await req.json();
    const { newPassword } = resetPasswordSchema.parse(body);

    const result = await resetPlatformStaffPassword({ platformUserId: platformUser.id }, id, newPassword);
    return NextResponse.json(
      { data: result },
      { headers: { "x-toast-success": `Password reset for ${result.email}.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
