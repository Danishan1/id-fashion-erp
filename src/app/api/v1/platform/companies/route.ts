import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin, handleApiError } from "@/lib/api-route";
import { createCompanySchema } from "@/modules/platform/platform-company.schema";
import { listCompanies, createCompany } from "@/modules/platform/platform-company.service";

export async function GET() {
  try {
    await requirePlatformAdmin();
    return NextResponse.json({ data: await listCompanies() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requirePlatformAdmin();

    const input = createCompanySchema.parse(await req.json());
    const result = await createCompany({ userId: session.user.id }, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
