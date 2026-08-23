import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { CustomerInput, CustomerUpdateInput, BuyerInput } from "./customer.schema";
import { BuyerRepository, CustomerRepository } from "./customer.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listCustomers(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    deletedAt: null,
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
    CustomerRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    CustomerRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getCustomerById(companyId: string, id: string) {
  const customer = await CustomerRepository.findByIdWithBuyers(companyId, id);
  if (!customer) {
    throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id });
  }
  return customer;
}

export async function createCustomer(actor: ActorContext, input: CustomerInput) {
  const existing = await CustomerRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const customer = await CustomerRepository.create({
    companyId: actor.companyId,
    code: input.code,
    name: input.name,
    type: input.type,
    country: input.country || null,
    paymentTermsDays: input.paymentTermsDays ?? null,
    creditLimit: input.creditLimit ?? null,
    defaultCurrencyCode: input.defaultCurrencyCode || null,
    isActive: input.isActive,
  });

  await advanceMasterCodeSequence(actor.companyId, "CUSTOMER");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "customers",
    recordId: customer.id,
    action: "CREATE",
    newValues: customer,
  });

  return customer;
}

export async function updateCustomer(actor: ActorContext, id: string, input: CustomerUpdateInput) {
  const before = await getCustomerById(actor.companyId, id);

  if (input.code !== undefined && input.code !== before.code) {
    const codeInUse = await CustomerRepository.findByCode(actor.companyId, input.code, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`, {
        code: input.code,
      });
    }
  }

  const data: Prisma.CustomerUncheckedUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.country !== undefined) data.country = input.country || null;
  if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays ?? null;
  if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit ?? null;
  if (input.defaultCurrencyCode !== undefined) data.defaultCurrencyCode = input.defaultCurrencyCode || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await CustomerRepository.update(id, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "customers",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function setCustomerActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getCustomerById(actor.companyId, id);
  const updated = await CustomerRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "customers",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function deactivateCustomer(actor: ActorContext, id: string) {
  const before = await getCustomerById(actor.companyId, id);

  const updated = await CustomerRepository.update(id, { isActive: false, deletedAt: new Date() });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "customers",
    recordId: id,
    action: "DELETE",
    oldValues: before,
  });

  return updated;
}

export async function createBuyer(actor: ActorContext, customerId: string, input: BuyerInput) {
  await getCustomerById(actor.companyId, customerId);

  const existing = await BuyerRepository.findByCode(customerId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Buyer code "${input.code}" is already in use for this customer.`);
  }

  const buyer = await BuyerRepository.create({
    companyId: actor.companyId,
    customerId,
    code: input.code,
    name: input.name,
    contactPerson: input.contactPerson || null,
    email: input.email || null,
    phone: input.phone || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "buyers",
    recordId: buyer.id,
    action: "CREATE",
    newValues: buyer,
  });

  return buyer;
}
