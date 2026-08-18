import { EmployeeForm } from "../EmployeeForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewEmployeePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Employees", href: "/masters/employees" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Employee</h1>
      <EmployeeForm submitUrl="/api/v1/employees" method="POST" redirectTo="/masters/employees" />
    </div>
  );
}
