import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalesInvoicesListClient } from "./SalesInvoicesListClient";

export default async function SalesInvoicesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "invoices", "view").catch(() => notFound());

  return <SalesInvoicesListClient />;
}
