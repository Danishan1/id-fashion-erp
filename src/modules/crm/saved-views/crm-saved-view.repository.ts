import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

const VIEW_SELECT = {
  id: true,
  entityType: true,
  name: true,
  filters: true,
  sort: true,
  columns: true,
  visibility: true,
  ownerUserId: true,
  updatedAt: true,
  owner: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmSavedViewSelect;

export const CrmSavedViewRepository = {
  listVisible(companyId: string, entityType: CrmEntityType, userId: string) {
    return prisma.crmSavedView.findMany({
      where: { companyId, entityType, OR: [{ ownerUserId: userId }, { visibility: "SHARED" }] },
      select: VIEW_SELECT,
      orderBy: { name: "asc" },
    });
  },
  findById(companyId: string, id: string) {
    return prisma.crmSavedView.findFirst({ where: { id, companyId }, select: VIEW_SELECT });
  },
  create(data: Prisma.CrmSavedViewUncheckedCreateInput) {
    return prisma.crmSavedView.create({ data, select: VIEW_SELECT });
  },
  update(id: string, data: Prisma.CrmSavedViewUncheckedUpdateInput) {
    return prisma.crmSavedView.update({ where: { id }, data, select: VIEW_SELECT });
  },
  delete(id: string) {
    return prisma.crmSavedView.delete({ where: { id } });
  },
};
