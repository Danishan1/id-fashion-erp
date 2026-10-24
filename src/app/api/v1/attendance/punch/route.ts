import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { punch } from "@/modules/hrms/attendance-punch.service";

function num(v: FormDataEntryValue | null): number {
  return v === null || v === "" ? Number.NaN : Number(v);
}

/** Multipart: type (IN|OUT), latitude, longitude, accuracy, address?, facePhotoId?, selfie (image). */
export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance", "create", async (actor) => {
    const form = await req.formData();
    const selfie = form.get("selfie");
    const accuracy = num(form.get("accuracy"));
    return punch(actor, {
      type: String(form.get("type") ?? "") as "IN" | "OUT",
      latitude: num(form.get("latitude")),
      longitude: num(form.get("longitude")),
      accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
      address: (form.get("address") as string | null) || null,
      facePhotoId: (form.get("facePhotoId") as string | null) || null,
      selfie: selfie instanceof File && selfie.size > 0 ? selfie : null,
    });
  });
}
