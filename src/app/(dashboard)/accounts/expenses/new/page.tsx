import { ExpenseForm } from "./ExpenseForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewExpensePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Expenses", href: "/accounts/expenses" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Expense</h1>
      <ExpenseForm />
    </div>
  );
}
