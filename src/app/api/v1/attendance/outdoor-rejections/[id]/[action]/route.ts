import { NextRequest, NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import {
  acceptOutdoorRejection,
  cancelOutdoorRejection,
  clarifyOutdoorRejection,
  decideOutdoorClarification,
  readOutdoorProof,
} from "@/modules/hrms/outdoor-attendance.service";

type Params = { params: Promise<{ id: string; action: string }> };

/** Employee: accept | clarify (multipart reason + proof). Admin: approve | reject | cancel. */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, action } = await params;
  switch (action) {
    case "accept":
      return hrmsRoute("hrms_attendance", "view", (actor) => acceptOutdoorRejection(actor, id));
    case "clarify":
      return hrmsRoute("hrms_attendance", "view", async (actor) => {
        const form = await req.formData();
        const proof = form.get("proof");
        return clarifyOutdoorRejection(actor, id, String(form.get("reason") ?? ""), proof instanceof File && proof.size > 0 ? proof : null);
      });
    case "approve":
      return hrmsRoute("hrms_attendance", "approve", (actor) => decideOutdoorClarification(actor, id, "APPROVED"));
    case "reject":
      return hrmsRoute("hrms_attendance", "reject", (actor) => decideOutdoorClarification(actor, id, "REJECTED"));
    case "cancel":
      return hrmsRoute("hrms_attendance", "approve", (actor) => cancelOutdoorRejection(actor, id));
    default:
      return hrmsRoute("hrms_attendance", "view", async () => {
        throw new BusinessRuleError("NOT_FOUND", "Unknown action.");
      });
  }
}

/** GET .../proof downloads the clarification proof. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, action } = await params;
  return hrmsRoute("hrms_attendance", "view", async (actor) => {
    if (action !== "proof") throw new BusinessRuleError("NOT_FOUND", "Not found.");
    const file = await readOutdoorProof(actor, id);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: { "Content-Type": file.mimeType, "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"` },
    });
  });
}
