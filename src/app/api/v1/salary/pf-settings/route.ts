import type { NextRequest } from "next/server";
import { statutoryCollectionHandlers } from "@/modules/hrms/salary-setup.routes";

const handlers = statutoryCollectionHandlers("PF");

export function GET() {
  return handlers.GET();
}

export function POST(req: NextRequest) {
  return handlers.POST(req);
}
