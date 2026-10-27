import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MyAttendanceClient } from "./MyAttendanceClient";

export default async function MyAttendancePage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "view").catch(() => notFound());
  // HR / Admin / Super Admin (attendance "edit") can enrol face photos, including their own.
  const canEnrolFaces = await PermissionService.can(session!.user.id, "hrms_attendance_settings", "edit");
  return <MyAttendanceClient canEnrolFaces={canEnrolFaces} />;
}
