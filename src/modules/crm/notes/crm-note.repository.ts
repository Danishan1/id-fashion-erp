import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const NOTE_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  body: true,
  createdAt: true,
  editedAt: true,
  createdByUserId: true,
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmNoteSelect;

export const CrmNoteRepository = {
  list(companyId: string, entityType: CrmEntityType, entityId: string) {
    return prisma.crmNote.findMany({
      where: { companyId, entityType, entityId, deletedAt: null },
      select: NOTE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  },
  findById(companyId: string, id: string) {
    return prisma.crmNote.findFirst({ where: { id, companyId, deletedAt: null }, select: NOTE_SELECT });
  },
  create(data: Prisma.CrmNoteUncheckedCreateInput, db: CrmDb = prisma) {
    return db.crmNote.create({ data, select: NOTE_SELECT });
  },
  /** Company-scoped: a note id from another company never matches. */
  update(companyId: string, id: string, data: Prisma.CrmNoteUncheckedUpdateInput, db: CrmDb = prisma) {
    return db.crmNote.update({ where: { id, companyId }, data, select: NOTE_SELECT });
  },
};

export type CrmNoteRow = Prisma.CrmNoteGetPayload<{ select: typeof NOTE_SELECT }>;
