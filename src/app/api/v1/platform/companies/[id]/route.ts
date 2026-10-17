import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { updateCompanyDetailsSchema } from "@/modules/platform/platform-company-lifecycle.schema";
import { getCompanyDetail, updateCompanyDetails } from "@/modules/platform/platform-company-lifecycle.service";

/** PLAT-016: a company's details, usage statistics and module states. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await getCompanyDetail(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession(["PLATFORM_SUPER_ADMIN"]);
    const { id } = await params;
    const input = updateCompanyDetailsSchema.parse(await req.json());
    const company = await updateCompanyDetails({ platformUserId: platformUser.id }, id, input);
    return NextResponse.json({ data: company }, { headers: { "x-toast-success": "Company details saved." } });
  } catch (error) {
    return handleApiError(error);
  }
}
