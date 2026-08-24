import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { markNotificationRead } from "@/core/notifications/NotificationService";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;

    await markNotificationRead(session.user.companyId, session.user.id, id);

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}
