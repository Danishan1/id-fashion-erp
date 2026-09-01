import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { PurchaseInvoicesListClient } from "./PurchaseInvoicesListClient";

export default async function PurchaseInvoicesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "invoices", "view").catch(() => notFound());

  return <PurchaseInvoicesListClient />;
}
