import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setPieceRateCardActiveStatus } from "@/modules/production/piece-rate-card.service";

const statusSchema = z.object({ isActive: z.boolean() });

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "edit");

    const { id } = await params;
    const { isActive } = statusSchema.parse(await req.json());
    const card = await setPieceRateCardActiveStatus({ companyId: session.user.companyId, userId: session.user.id }, id, isActive);
    return NextResponse.json({ data: card });
  } catch (error) {
    return handleApiError(error);
  }
}
