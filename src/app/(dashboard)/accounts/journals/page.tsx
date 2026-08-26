import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { JournalsListClient } from "./JournalsListClient";

export default async function JournalsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "accounts", "view").catch(() => notFound());

  return <JournalsListClient />;
}
