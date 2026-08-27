import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getEmployeeAdvanceById } from "@/modules/accounts/employee-advance.service";
import { EmployeeAdvanceWorkflowPanel } from "./EmployeeAdvanceWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EmployeeAdvanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const advance = await getEmployeeAdvanceById(session!.user.companyId, id).catch(() => null);
  if (!advance) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Employee Advances", href: "/accounts/employee-advances" },
            { label: advance.advanceNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{advance.advanceNumber}</h1>
      </div>

      <EmployeeAdvanceWorkflowPanel key={id} advance={JSON.parse(JSON.stringify(advance))} />
    </div>
  );
}
