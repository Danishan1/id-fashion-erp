import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CustomInvoicesListClient } from "./CustomInvoicesListClient";

export default async function CustomInvoicesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "invoices", "view").catch(() => notFound());

  return <CustomInvoicesListClient />;
}
