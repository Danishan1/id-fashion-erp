import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MyAttendanceClient } from "./MyAttendanceClient";

export default async function MyAttendancePage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "view").catch(() => notFound());
  return <MyAttendanceClient />;
}
