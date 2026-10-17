import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { listPlatformStaff, createPlatformStaff } from "@/modules/platform/platform-staff.service";

const createStaffSchema = z.object({
  email: z.string().email("A valid email is required."),
  fullName: z.string().min(2, "Full name must be at least 2 characters."),
  role: z.enum(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT", "BILLING_ADMIN"]),
  password: z.string().min(8, "Password must be at least 8 characters long."),
});

export async function GET() {
  try {
    await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const staff = await listPlatformStaff();
    return NextResponse.json({ data: staff });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const body = await req.json();
    const input = createStaffSchema.parse(body);

    const newStaff = await createPlatformStaff({ platformUserId: platformUser.id }, input);
    return NextResponse.json(
      { data: newStaff },
      { headers: { "x-toast-success": `Operator ${newStaff.fullName} created.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
