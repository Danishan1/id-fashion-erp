import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BuyerEnquiriesListClient } from "./BuyerEnquiriesListClient";

export default async function BuyerEnquiriesListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "buyer_enquiries", "view").catch(() => notFound());

  return <BuyerEnquiriesListClient />;
}
