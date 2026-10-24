import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { PunchPhotosClient } from "./PunchPhotosClient";

export default async function PunchPhotosPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "hrms_attendance", "view").catch(() => notFound());
  const canOverride = await PermissionService.can(session!.user.id, "hrms_attendance", "override");
  return <PunchPhotosClient canOverride={canOverride} />;
}
