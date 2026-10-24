import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { AttendanceSettingsClient } from "./AttendanceSettingsClient";

export default async function AttendanceSettingsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "edit").catch(() => notFound());
  return <AttendanceSettingsClient />;
}
