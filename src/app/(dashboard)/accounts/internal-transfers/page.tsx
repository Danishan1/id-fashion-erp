import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { InternalTransfersListClient } from "./InternalTransfersListClient";

export default async function InternalTransfersListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "accounts", "view").catch(() => notFound());

  return <InternalTransfersListClient />;
}
