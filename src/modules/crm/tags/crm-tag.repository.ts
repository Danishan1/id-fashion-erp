import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const TAG_SELECT = { id: true, name: true, color: true } satisfies Prisma.CrmTagSelect;

export const CrmTagRepository = {
  list(companyId: string, search: string | undefined, take: number) {
    return prisma.crmTag.findMany({
      where: { companyId, ...(search ? { nameKey: { contains: search.toLowerCase() } } : {}) },
      select: { ...TAG_SELECT, _count: { select: { assignments: true } } },
      orderBy: { name: "asc" },
      take,
    });
  },
  findById(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmTag.findFirst({ where: { id, companyId }, select: TAG_SELECT });
  },
  findManyByIds(companyId: string, ids: string[], db: CrmDb = prisma) {
    return db.crmTag.findMany({ where: { companyId, id: { in: ids } }, select: TAG_SELECT });
  },
  findManyByKeys(companyId: string, keys: string[], db: CrmDb = prisma) {
    return db.crmTag.findMany({ where: { companyId, nameKey: { in: keys } }, select: { ...TAG_SELECT, nameKey: true } });
  },
  createMany(data: Prisma.CrmTagCreateManyInput[], db: CrmDb = prisma) {
    return db.crmTag.createMany({ data, skipDuplicates: true });
  },
  update(id: string, data: Prisma.CrmTagUncheckedUpdateInput) {
    return prisma.crmTag.update({ where: { id }, data, select: TAG_SELECT });
  },
  delete(id: string) {
    return prisma.crmTag.delete({ where: { id } });
  },
  /** Tag ids already on one record. */
  assignedTagIds(companyId: string, entityType: CrmEntityType, entityId: string, db: CrmDb = prisma) {
    return db.crmEntityTag.findMany({ where: { companyId, entityType, entityId }, select: { tagId: true } });
  },
  assign(data: Prisma.CrmEntityTagCreateManyInput[], db: CrmDb = prisma) {
    return db.crmEntityTag.createMany({ data, skipDuplicates: true });
  },
  unassign(companyId: string, entityType: CrmEntityType, entityId: string, tagIds: string[], db: CrmDb = prisma) {
    return db.crmEntityTag.deleteMany({ where: { companyId, entityType, entityId, tagId: { in: tagIds } } });
  },
  /** Tags for many records in one query (list pages). */
  tagsForEntities(companyId: string, entityType: CrmEntityType, entityIds: string[]) {
    return prisma.crmEntityTag.findMany({
      where: { companyId, entityType, entityId: { in: entityIds } },
      select: { entityId: true, tag: { select: TAG_SELECT } },
      orderBy: { tag: { name: "asc" } },
    });
  },
};

export type CrmTagDto = { id: string; name: string; color: string | null };
