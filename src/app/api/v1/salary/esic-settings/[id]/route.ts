import type { NextRequest } from "next/server";
import { statutoryItemHandlers } from "@/modules/hrms/salary-setup.routes";

const handlers = statutoryItemHandlers("ESIC");

export function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handlers.PATCH(req, ctx);
}
