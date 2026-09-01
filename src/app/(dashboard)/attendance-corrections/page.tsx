import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AttendanceCorrectionsListClient } from "./AttendanceCorrectionsListClient";

export default async function AttendanceCorrectionsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "view").catch(() => notFound());

  return <AttendanceCorrectionsListClient />;
}
