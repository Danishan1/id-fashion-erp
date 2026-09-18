import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { markPieceRateEarningPaid } from "@/modules/production/piece-rate-earning.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const earning = await markPieceRateEarningPaid({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: earning });
  } catch (error) {
    return handleApiError(error);
  }
}
