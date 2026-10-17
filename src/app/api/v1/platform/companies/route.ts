import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { createCompanySchema } from "@/modules/platform/platform-company.schema";
import { listCompanies, createCompany } from "@/modules/platform/platform-company.service";

export async function GET() {
  try {
    await requirePlatformSession();
    return NextResponse.json({ data: await listCompanies() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Provisioning a new tenant is a Platform Super Admin action only.
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);

    const input = createCompanySchema.parse(await req.json());
    const result = await createCompany({ platformUserId: platformUser.id }, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
