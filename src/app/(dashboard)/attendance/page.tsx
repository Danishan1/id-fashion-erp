import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AttendanceListClient } from "./AttendanceListClient";

export default async function AttendancePage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "view").catch(() => notFound());

  return <AttendanceListClient />;
}
