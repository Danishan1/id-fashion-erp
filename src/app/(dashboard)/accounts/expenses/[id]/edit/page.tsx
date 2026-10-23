import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getExpenseById } from "@/modules/accounts/expense.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ExpenseForm } from "../../new/ExpenseForm";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const expense = await getExpenseById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!expense) notFound();

  // Matches the service's own guard — nothing else can be edited here.
  if (expense.status !== "PENDING_APPROVAL") notFound();

  const initialExpense = {
    id: expense.id,
    expenseDate: expense.expenseDate.toISOString(),
    accountId: expense.accountId,
    supplierId: expense.supplierId,
    description: expense.description,
    amount: expense.amount.toString(),
    taxRateId: expense.taxRateId,
    tdsPercentage: expense.tdsPercentage?.toString() ?? null,
    referenceNumber: expense.referenceNumber,
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Expenses", href: "/accounts/expenses" },
          { label: expense.expenseNumber, href: `/accounts/expenses/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {expense.expenseNumber}</h1>
      {/* key={id} forces a remount on client-side navigation between two
          different expenses' edit pages — same stale-data fix applied
          project-wide after the Sampling bug. */}
      <ExpenseForm key={id} initialExpense={initialExpense} />
    </div>
  );
}
