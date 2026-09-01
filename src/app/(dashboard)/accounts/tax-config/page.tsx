import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { TaxConfigClient } from "./TaxConfigClient";

export default async function TaxConfigPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "accounts", "view").catch(() => notFound());

  return <TaxConfigClient />;
}
