import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import {
  HIERARCHY_MODULES,
  invalidateTeamScope,
  loadManagerMap,
  wouldCreateLoop,
  type HierarchyModule,
} from "@/core/hierarchy/team-scope";

interface ActorContext {
  companyId: string;
  userId: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const setReportingLineSchema = z
  .object({
    module: z.enum(HIERARCHY_MODULES as [HierarchyModule, ...HierarchyModule[]]),
    /** null = remove this module's line (fall back to the general Reports To). */
    managerId: z.string().uuid().nullable(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional().nullable(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });
export type SetReportingLineInput = z.infer<typeof setReportingLineSchema>;

async function assertEmployeeInCompany(companyId: string, id: string, label: string) {
  const employee = await prisma.employee.findFirst({
    where: { id, companyId, deletedAt: null },
    select: { id: true, fullName: true, isActive: true },
  });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", `${label} not found.`, { id });
  return employee;
}

/** Active lines for one employee, one per module at most. */
export async function listReportingLines(companyId: string, employeeId: string) {
  await assertEmployeeInCompany(companyId, employeeId, "Employee");
  return prisma.employeeReportingLine.findMany({
    where: { companyId, employeeId, isActive: true },
    select: {
      id: true,
      module: true,
      startDate: true,
      endDate: true,
      manager: { select: { id: true, fullName: true, employeeCode: true } },
    },
    orderBy: { module: "asc" },
  });
}

/**
 * Sets (or removes) an employee's manager for one module. The previous
 * active line is closed, never deleted, so history stays. A change that
 * would create a loop (A -> B -> A) is refused.
 */
export async function setReportingLine(actor: ActorContext, employeeId: string, input: SetReportingLineInput) {
  await assertEmployeeInCompany(actor.companyId, employeeId, "Employee");
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  if (input.managerId) {
    const manager = await assertEmployeeInCompany(actor.companyId, input.managerId, "Manager");
    if (!manager.isActive) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${manager.fullName} is inactive and can't be a manager.`, {
        field: "managerId",
      });
    }
    const managers = await loadManagerMap(actor.companyId, input.module);
    if (wouldCreateLoop(managers, employeeId, input.managerId)) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `${manager.fullName} already reports (directly or indirectly) to this employee in ${input.module} -- that would create a loop.`,
        { field: "managerId" }
      );
    }
  }

  const before = await prisma.employeeReportingLine.findFirst({
    where: { companyId: actor.companyId, employeeId, module: input.module, isActive: true },
    select: { id: true, managerId: true, startDate: true, endDate: true },
  });

  const line = await prisma.$transaction(async (tx) => {
    if (before) {
      await tx.employeeReportingLine.update({
        where: { id: before.id },
        data: { isActive: false, endDate: before.endDate ?? today },
      });
    }
    if (!input.managerId) return null;
    return tx.employeeReportingLine.create({
      data: {
        companyId: actor.companyId,
        employeeId,
        managerId: input.managerId,
        module: input.module,
        startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : today,
        endDate: input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : null,
        createdByUserId: actor.userId,
      },
    });
  });

  invalidateTeamScope(actor.companyId);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_reporting_lines",
    recordId: line?.id ?? before?.id ?? employeeId,
    action: line ? "CREATE" : "UPDATE",
    oldValues: before ? { module: input.module, managerId: before.managerId } : undefined,
    newValues: { employeeId, module: input.module, managerId: input.managerId, startDate: input.startDate, endDate: input.endDate },
  });
  return line;
}
