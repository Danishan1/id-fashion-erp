import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { addFacePhotos, listFacePhotos } from "@/modules/hrms/face-enrolment.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return hrmsRoute("hrms_attendance_settings", "edit", (actor) => listFacePhotos(actor.companyId, employeeId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return hrmsRoute(
    "hrms_attendance_settings",
    "edit",
    async (actor) => {
      const form = await req.formData();
      const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
      return addFacePhotos(actor, employeeId, files);
    },
    201
  );
}
