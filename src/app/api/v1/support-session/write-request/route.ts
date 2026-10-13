import { NextRequest, NextResponse } from "next/server";
import { requireSupportSession, handleApiError } from "@/lib/api-route";
import { writeAccessRequestSchema } from "@/modules/support-access/support-access.schema";
import { requestWriteAccess } from "@/modules/support-access/support-access.service";

/** PLAT-013: returns a second 6-digit code once; the customer must enter it. */
export async function POST(req: NextRequest) {
  try {
    const { live } = await requireSupportSession();
    const { justification } = writeAccessRequestSchema.parse(await req.json());
    const result = await requestWriteAccess(live.id, justification);
    return NextResponse.json({ data: result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
