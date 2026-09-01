import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { NewPlatformCompanyClient } from "./NewPlatformCompanyClient";

export default async function NewPlatformCompanyPage() {
  const session = await auth();
  if (!session?.user.isPlatformAdmin) notFound();

  return <NewPlatformCompanyClient />;
}
