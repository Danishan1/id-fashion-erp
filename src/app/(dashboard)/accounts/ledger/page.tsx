import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { LedgerClient } from "./LedgerClient";

export default async function LedgerPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "accounts", "view").catch(() => notFound());

  return <LedgerClient />;
}
