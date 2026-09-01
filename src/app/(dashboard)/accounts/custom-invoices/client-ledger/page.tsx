import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ClientLedgerClient } from "./ClientLedgerClient";

export default async function CustomInvoiceClientLedgerPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "invoices", "view").catch(() => notFound());

  return <ClientLedgerClient />;
}
