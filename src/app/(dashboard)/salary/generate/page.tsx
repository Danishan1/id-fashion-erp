import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { GenerateSalaryClient } from "./GenerateSalaryClient";

export default async function GenerateSalaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "hrms_salary_generate", "view").catch(() => notFound());
  const can = async (action: "create" | "edit" | "approve" | "reject" | "post" | "cancel") => PermissionService.can(userId, "hrms_salary_generate", action);
  const [generate, edit, approve, sendBack, finalise, reopen] = await Promise.all([can("create"), can("edit"), can("approve"), can("reject"), can("post"), can("cancel")]);
  const { month } = await searchParams;
  return <GenerateSalaryClient initialMonth={month ?? null} currentUserId={userId} can={{ generate, edit, approve, sendBack, finalise, reopen }} />;
}
