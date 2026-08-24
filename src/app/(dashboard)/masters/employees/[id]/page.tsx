import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getEmployeeById } from "@/modules/employees/employee.service";
import { EmployeeForm } from "../EmployeeForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const employee = await getEmployeeById(session!.user.companyId, id).catch(() => null);
  if (!employee) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Employees", href: "/masters/employees" },
            { label: employee.fullName },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{employee.fullName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {employee.employeeCode}</p>
      </div>

      <EmployeeForm
        key={id}
        submitUrl={`/api/v1/employees/${id}`}
        method="PATCH"
        redirectTo="/masters/employees"
        initialValues={{
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          departmentId: employee.departmentId ?? "",
          shiftId: employee.shiftId ?? "",
          designation: employee.designation ?? "",
          phone: employee.phone ?? "",
          email: employee.email ?? "",
          joinDate: employee.joinDate ? employee.joinDate.toISOString().slice(0, 10) : "",
          isActive: employee.isActive,
        }}
      />
    </div>
  );
}
