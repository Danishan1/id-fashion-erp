import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { FaceEnrolmentClient } from "./FaceEnrolmentClient";

export default async function FaceEnrolmentPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance_settings", "edit").catch(() => notFound());
  const { employeeId } = await params;
  return <FaceEnrolmentClient key={employeeId} employeeId={employeeId} />;
}
