import { NextResponse } from "next/server";
import { requireSupportSession, handleApiError } from "@/lib/api-route";
import { getSupportSessionStatus } from "@/modules/support-access/support-access.service";

export async function GET() {
  try {
    const { live } = await requireSupportSession();
    return NextResponse.json({ data: await getSupportSessionStatus(live.id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
