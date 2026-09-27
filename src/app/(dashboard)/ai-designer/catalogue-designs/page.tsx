import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CatalogueGalleryClient } from "./CatalogueGalleryClient";

export default async function CatalogueDesignsPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "ai_designer", "view").catch(() => notFound());

  return <CatalogueGalleryClient />;
}
