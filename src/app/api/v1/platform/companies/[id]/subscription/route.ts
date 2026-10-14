import { NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { getCompanySubscription } from "@/modules/platform/company-subscription.service";

/** PLAT-021: a company's plan, derived state, user usage and payment history. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await getCompanySubscription(id) });
  } catch (error) {
    return handleApiError(error);
  }
}
