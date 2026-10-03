import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

export const CrmLeadStatusRepository = {
  list(companyId: string, includeInactive = true) {
    return prisma.crmLeadStatus.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },
  count(companyId: string) {
    return prisma.crmLeadStatus.count({ where: { companyId } });
  },
  createMany(data: Prisma.CrmLeadStatusCreateManyInput[]) {
    return prisma.crmLeadStatus.createMany({ data, skipDuplicates: true });
  },
  findById(companyId: string, id: string) {
    return prisma.crmLeadStatus.findFirst({ where: { id, companyId } });
  },
  findByKey(companyId: string, key: string) {
    return prisma.crmLeadStatus.findFirst({ where: { companyId, key } });
  },
  findDefault(companyId: string) {
    return prisma.crmLeadStatus.findFirst({ where: { companyId, isDefault: true, isActive: true } });
  },
  findFirstOfKind(companyId: string, kind: "OPEN" | "CONVERTED" | "LOST") {
    return prisma.crmLeadStatus.findFirst({ where: { companyId, kind, isActive: true }, orderBy: { sortOrder: "asc" } });
  },
  create(data: Prisma.CrmLeadStatusUncheckedCreateInput) {
    return prisma.crmLeadStatus.create({ data });
  },
  update(id: string, data: Prisma.CrmLeadStatusUncheckedUpdateInput, db: CrmDb = prisma) {
    return db.crmLeadStatus.update({ where: { id }, data });
  },
  clearDefault(companyId: string, db: CrmDb = prisma) {
    return db.crmLeadStatus.updateMany({ where: { companyId, isDefault: true }, data: { isDefault: false } });
  },
  countActiveOfKind(companyId: string, kind: "OPEN" | "CONVERTED" | "LOST", excludeId?: string) {
    return prisma.crmLeadStatus.count({ where: { companyId, kind, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  },
  countLeadsUsing(companyId: string, statusId: string) {
    return prisma.crmLead.count({ where: { companyId, statusId } });
  },
  maxSortOrder(companyId: string) {
    return prisma.crmLeadStatus.aggregate({ where: { companyId }, _max: { sortOrder: true } });
  },
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return prisma.$transaction(fn);
  },
};

export const CrmLeadSourceRepository = {
  list(companyId: string, includeInactive = true) {
    return prisma.crmLeadSource.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },
  count(companyId: string) {
    return prisma.crmLeadSource.count({ where: { companyId } });
  },
  createMany(data: Prisma.CrmLeadSourceCreateManyInput[]) {
    return prisma.crmLeadSource.createMany({ data, skipDuplicates: true });
  },
  findById(companyId: string, id: string) {
    return prisma.crmLeadSource.findFirst({ where: { id, companyId } });
  },
  findByKey(companyId: string, key: string) {
    return prisma.crmLeadSource.findFirst({ where: { companyId, key } });
  },
  create(data: Prisma.CrmLeadSourceUncheckedCreateInput) {
    return prisma.crmLeadSource.create({ data });
  },
  update(id: string, data: Prisma.CrmLeadSourceUncheckedUpdateInput) {
    return prisma.crmLeadSource.update({ where: { id }, data });
  },
  maxSortOrder(companyId: string) {
    return prisma.crmLeadSource.aggregate({ where: { companyId }, _max: { sortOrder: true } });
  },
};

export const CrmSettingsRepository = {
  find(companyId: string) {
    return prisma.crmSettings.findUnique({ where: { companyId } });
  },
  upsertContactDuplicateRules(companyId: string, rules: Prisma.InputJsonValue, defaultLeadRules: Prisma.InputJsonValue, userId: string) {
    return prisma.crmSettings.upsert({
      where: { companyId },
      create: { companyId, leadDuplicateRules: defaultLeadRules, contactDuplicateRules: rules, updatedByUserId: userId },
      update: { contactDuplicateRules: rules, updatedByUserId: userId },
    });
  },
  upsertDuplicateRules(companyId: string, rules: Prisma.InputJsonValue, userId: string) {
    return prisma.crmSettings.upsert({
      where: { companyId },
      create: { companyId, leadDuplicateRules: rules, updatedByUserId: userId },
      update: { leadDuplicateRules: rules, updatedByUserId: userId },
    });
  },
};

export const CrmOptionValueRepository = {
  list(companyId: string, listKey: string, includeInactive = true) {
    return prisma.crmOptionValue.findMany({
      where: { companyId, listKey, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
    });
  },
  listAll(companyId: string, includeInactive = false) {
    return prisma.crmOptionValue.findMany({ where: { companyId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ listKey: "asc" }, { sortOrder: "asc" }, { value: "asc" }] });
  },
  count(companyId: string) {
    return prisma.crmOptionValue.count({ where: { companyId } });
  },
  createMany(data: Prisma.CrmOptionValueCreateManyInput[]) {
    return prisma.crmOptionValue.createMany({ data, skipDuplicates: true });
  },
  create(data: Prisma.CrmOptionValueUncheckedCreateInput) {
    return prisma.crmOptionValue.create({ data });
  },
  findById(companyId: string, id: string) {
    return prisma.crmOptionValue.findFirst({ where: { id, companyId } });
  },
  findByKey(companyId: string, listKey: string, valueKey: string) {
    return prisma.crmOptionValue.findFirst({ where: { companyId, listKey, valueKey } });
  },
  update(id: string, data: Prisma.CrmOptionValueUncheckedUpdateInput) {
    return prisma.crmOptionValue.update({ where: { id }, data });
  },
  maxSortOrder(companyId: string, listKey: string) {
    return prisma.crmOptionValue.aggregate({ where: { companyId, listKey }, _max: { sortOrder: true } });
  },
};
