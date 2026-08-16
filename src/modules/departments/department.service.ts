import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { DepartmentInput } from "./department.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listDepartments(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { code: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.department.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    prisma.department.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getDepartmentById(companyId: string, id: string) {
  const department = await prisma.department.findFirst({ where: { id, companyId } });
  if (!department) throw new BusinessRuleError("NOT_FOUND", "Department not found.", { id });
  return department;
}

export async function createDepartment(actor: ActorContext, input: DepartmentInput) {
  const existing = await prisma.department.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Department code "${input.code}" is already in use.`);
  }

  const department = await prisma.department.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "departments",
    recordId: department.id,
    action: "CREATE",
    newValues: department,
  });

  return department;
}

export async function updateDepartment(actor: ActorContext, id: string, input: DepartmentInput) {
  const before = await getDepartmentById(actor.companyId, id);

  if (input.code !== before.code) {
    const codeInUse = await prisma.department.findFirst({
      where: { companyId: actor.companyId, code: input.code, id: { not: id } },
    });
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Department code "${input.code}" is already in use.`);
    }
  }

  const updated = await prisma.department.update({ where: { id }, data: { code: input.code, name: input.name } });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "departments",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}
