import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { toggleCompanyUserStatus } from "@/modules/platform/platform-company-lifecycle.service";

const updateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const { id, userId } = await params;
    const body = await req.json();
    const { status } = updateStatusSchema.parse(body);

    const result = await toggleCompanyUserStatus(
      { platformUserId: platformUser.id },
      id,
      userId,
      status
    );

    return NextResponse.json(
      { data: result },
      { headers: { "x-toast-success": `User status updated to ${status}.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
