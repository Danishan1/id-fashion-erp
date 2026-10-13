import { NextResponse } from "next/server";
import { requireSupportSession, handleApiError } from "@/lib/api-route";
import { endSupportSession } from "@/modules/support-access/support-access.service";

export async function POST() {
  try {
    const { live } = await requireSupportSession();
    await endSupportSession(live.id);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
