import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CreditNotesListClient } from "./CreditNotesListClient";

export default async function CustomInvoiceCreditNotesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "invoices", "view").catch(() => notFound());

  return <CreditNotesListClient />;
}
