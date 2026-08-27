import { EmployeeAdvanceForm } from "./EmployeeAdvanceForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewEmployeeAdvancePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Employee Advances", href: "/accounts/employee-advances" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Employee Advance</h1>
      <EmployeeAdvanceForm />
    </div>
  );
}
