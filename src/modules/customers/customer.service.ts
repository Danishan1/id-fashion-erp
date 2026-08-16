import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { CustomerInput, BuyerInput } from "./customer.schema";

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
    prisma.customer.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    prisma.customer.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getCustomerById(companyId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, companyId, deletedAt: null },
    include: { buyers: { orderBy: { name: "asc" } } },
  });
  if (!customer) {
    throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id });
  }
  return customer;
}

export async function createCustomer(actor: ActorContext, input: CustomerInput) {
  const existing = await prisma.customer.findFirst({
    where: { companyId: actor.companyId, code: input.code, deletedAt: null },
  });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const customer = await prisma.customer.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      type: input.type,
      country: input.country || null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      creditLimit: input.creditLimit ?? null,
      defaultCurrencyCode: input.defaultCurrencyCode || null,
      isActive: input.isActive,
    },
  });

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

export async function updateCustomer(actor: ActorContext, id: string, input: CustomerInput) {
  const before = await getCustomerById(actor.companyId, id);

  if (input.code !== before.code) {
    const codeInUse = await prisma.customer.findFirst({
      where: { companyId: actor.companyId, code: input.code, deletedAt: null, id: { not: id } },
    });
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`, {
        code: input.code,
      });
    }
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      type: input.type,
      country: input.country || null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      creditLimit: input.creditLimit ?? null,
      defaultCurrencyCode: input.defaultCurrencyCode || null,
      isActive: input.isActive,
    },
  });

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

  const updated = await prisma.customer.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });

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

  const existing = await prisma.buyer.findFirst({ where: { customerId, code: input.code } });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Buyer code "${input.code}" is already in use for this customer.`);
  }

  const buyer = await prisma.buyer.create({
    data: {
      companyId: actor.companyId,
      customerId,
      code: input.code,
      name: input.name,
      contactPerson: input.contactPerson || null,
      email: input.email || null,
      phone: input.phone || null,
    },
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
