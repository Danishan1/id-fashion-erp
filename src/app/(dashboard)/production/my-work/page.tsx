import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { MyWorkClient } from "./MyWorkClient";

export default async function MyWorkPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "production", "view").catch(() => notFound());

  return <MyWorkClient />;
}
