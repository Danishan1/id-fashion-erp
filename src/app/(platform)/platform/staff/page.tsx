import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listPlatformStaff } from "@/modules/platform/platform-staff.service";
import { PlatformStaffClient } from "./PlatformStaffClient";

export default async function PlatformStaffPage() {
  const user = await getPlatformPageUser();
  if (!user || user.role !== "PLATFORM_SUPER_ADMIN") notFound();

  const rawStaff = await listPlatformStaff();

  const staff = rawStaff.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    lastLoginAt: s.lastLoginAt ? s.lastLoginAt.toISOString() : null,
  }));

  return <PlatformStaffClient initialStaff={staff} currentUserId={user.id} />;
}
