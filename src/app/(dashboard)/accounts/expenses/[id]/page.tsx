import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getExpenseById } from "@/modules/accounts/expense.service";
import { ExpenseWorkflowPanel } from "./ExpenseWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const expense = await getExpenseById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!expense) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Expenses", href: "/accounts/expenses" },
            { label: expense.expenseNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{expense.expenseNumber}</h1>
      </div>

      <ExpenseWorkflowPanel key={id} expense={JSON.parse(JSON.stringify(expense))} />
    </div>
  );
}
