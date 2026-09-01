import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { GarmentAttributesClient } from "./GarmentAttributesClient";

export default async function GarmentAttributesPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "masters_core", "view").catch(() => notFound());

  return <GarmentAttributesClient />;
}
