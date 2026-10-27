import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MonthlyRecordsClient } from "./MonthlyRecordsClient";

export default async function MonthlyRecordsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance_records", "view").catch(() => notFound());
  const canExport = await PermissionService.can(session!.user.id, "hrms_attendance_records", "export");
  return <MonthlyRecordsClient canExport={canExport} />;
}
