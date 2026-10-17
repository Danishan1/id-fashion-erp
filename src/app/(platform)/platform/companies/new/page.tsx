import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { NewPlatformCompanyClient } from "./NewPlatformCompanyClient";

export default async function NewPlatformCompanyPage() {
  const user = await getPlatformPageUser();
  // Same rule as POST /api/v1/platform/companies: Platform Super Admin only.
  if (!user || user.role !== "PLATFORM_SUPER_ADMIN") notFound();

  return <NewPlatformCompanyClient />;
}
