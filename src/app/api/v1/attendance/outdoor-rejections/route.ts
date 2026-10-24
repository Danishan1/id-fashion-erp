import { NextRequest } from "next/server";
import type { OutdoorRejectionStatus } from "@prisma/client";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { listOutdoorRejections } from "@/modules/hrms/outdoor-attendance.service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  return hrmsRoute("hrms_attendance", "view", (actor) =>
    listOutdoorRejections(actor, {
      mine: p.get("mine") === "true",
      month: p.get("month") || undefined,
      status: status && ["PENDING", "IN_PROCESS", "APPROVED", "REJECTED"].includes(status) ? (status as OutdoorRejectionStatus) : undefined,
    })
  );
}
