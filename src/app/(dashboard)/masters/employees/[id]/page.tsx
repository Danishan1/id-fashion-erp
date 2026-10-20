import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getEmployeeById, getEmployeeLogin } from "@/modules/employees/employee.service";
import { PermissionService } from "@/core/rbac/PermissionService";
import { EmployeeLoginSection } from "../EmployeeLoginSection";
import { EmployeeEditFormClient } from "./EmployeeEditFormClient";
import { EmployeeAttachmentsSection } from "../EmployeeAttachmentsSection";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const employee = await getEmployeeById(session!.user.companyId, id).catch(() => null);
  if (!employee) notFound();
  const [login, canCreateLogin] = await Promise.all([
    getEmployeeLogin(session!.user.companyId, id),
    PermissionService.can(session!.user.id, "administration_users", "create"),
  ]);

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

      <EmployeeEditFormClient
        key={`form-${id}`}
        id={id}
        initialValues={{
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          departmentId: employee.departmentId ?? "",
          shiftId: employee.shiftId ?? "",
          designationId: employee.designationId ?? "",
          employeeCategoryId: employee.employeeCategoryId ?? "",
          reportsToId: employee.reportsToId ?? "",
          phone: employee.phone ?? "",
          email: employee.email ?? "",
          address: employee.address ?? "",
          city: employee.city ?? "",
          pinCode: employee.pinCode ?? "",
          country: employee.country ?? "",
          joinDate: employee.joinDate ? employee.joinDate.toISOString().slice(0, 10) : "",
          isActive: employee.isActive,
          workSkillStageIds: employee.workSkills.map((w) => w.productionStageId),
        }}
      />

      <EmployeeLoginSection
        key={`login-${id}`}
        employeeId={id}
        employeeEmail={employee.email}
        employeeActive={employee.isActive}
        login={login}
        canCreateLogin={canCreateLogin}
      />

      <div className="max-w-xl">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Direct Reports</h2>
        {employee.reports.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No one reports to {employee.fullName}.</p>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
            {employee.reports.map((r) => (
              <li key={r.id}>
                <a href={`/masters/employees/${r.id}`} className="text-indigo-600 hover:text-indigo-500">
                  {r.fullName} ({r.employeeCode})
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EmployeeAttachmentsSection key={`attachments-${id}`} employeeId={id} />
    </div>
  );
}
