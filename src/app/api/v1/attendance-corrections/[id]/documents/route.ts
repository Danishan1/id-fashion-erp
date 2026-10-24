import { NextRequest } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { addCorrectionDocument, listCorrectionDocuments } from "@/modules/hrms/attendance-correction.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_attendance", "view", (actor) => listCorrectionDocuments(actor, id));
}

/** Multipart `file` — proof for a regularization (medical slip, visit pass…). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute(
    "hrms_attendance",
    "create",
    async (actor) => {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || file.size === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a file.");
      return addCorrectionDocument(actor, id, file);
    },
    201
  );
}
