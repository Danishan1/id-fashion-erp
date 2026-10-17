import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { resetCompanyUserPassword } from "@/modules/platform/platform-company-lifecycle.service";

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters long."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const { id, userId } = await params;
    const body = await req.json();
    const { newPassword } = resetPasswordSchema.parse(body);

    const result = await resetCompanyUserPassword(
      { platformUserId: platformUser.id },
      id,
      userId,
      newPassword
    );

    return NextResponse.json(
      { data: result },
      { headers: { "x-toast-success": `Password reset successfully for ${result.email}.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
