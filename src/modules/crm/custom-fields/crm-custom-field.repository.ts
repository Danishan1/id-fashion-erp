import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export const CrmCustomFieldRepository = {
  list(companyId: string, entityType: CrmEntityType, includeInactive: boolean) {
    return prisma.crmCustomFieldDefinition.findMany({
      where: { companyId, entityType, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },
  findById(companyId: string, id: string) {
    return prisma.crmCustomFieldDefinition.findFirst({ where: { id, companyId } });
  },
  findByKey(companyId: string, entityType: CrmEntityType, key: string) {
    return prisma.crmCustomFieldDefinition.findFirst({ where: { companyId, entityType, key } });
  },
  maxSortOrder(companyId: string, entityType: CrmEntityType) {
    return prisma.crmCustomFieldDefinition.aggregate({ where: { companyId, entityType }, _max: { sortOrder: true } });
  },
  create(data: Prisma.CrmCustomFieldDefinitionUncheckedCreateInput) {
    return prisma.crmCustomFieldDefinition.create({ data });
  },
  update(id: string, data: Prisma.CrmCustomFieldDefinitionUncheckedUpdateInput) {
    return prisma.crmCustomFieldDefinition.update({ where: { id }, data });
  },
};
