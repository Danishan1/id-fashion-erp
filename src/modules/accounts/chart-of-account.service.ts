import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { ChartOfAccountInput } from "./chart-of-account.schema";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import type { Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listChartOfAccounts(companyId: string, query: ListQuery) {
  const where: Prisma.ChartOfAccountWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" as const } },
            { name: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    ChartOfAccountRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ChartOfAccountRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getChartOfAccountById(companyId: string, id: string) {
  const account = await ChartOfAccountRepository.findAnyById(companyId, id);
  if (!account) throw new BusinessRuleError("NOT_FOUND", "Account not found.", { id });
  return account;
}

export async function createChartOfAccount(actor: ActorContext, input: ChartOfAccountInput) {
  const existing = await ChartOfAccountRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Account code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const account = await ChartOfAccountRepository.create({
    companyId: actor.companyId,
    code: input.code,
    name: input.name,
    accountType: input.accountType,
    parentAccountId: input.parentAccountId || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "chart_of_accounts",
    recordId: account.id,
    action: "CREATE",
    newValues: { code: account.code, name: account.name, accountType: account.accountType },
  });

  return account;
}

export async function updateChartOfAccount(actor: ActorContext, id: string, input: ChartOfAccountInput) {
  const existing = await ChartOfAccountRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Account not found.", { id });

  if (input.code !== existing.code) {
    const duplicate = await ChartOfAccountRepository.findByCode(actor.companyId, input.code);
    if (duplicate) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Account code "${input.code}" is already in use.`, {
        code: input.code,
      });
    }
  }

  const updated = await ChartOfAccountRepository.update(id, {
    code: input.code,
    name: input.name,
    accountType: input.accountType,
    parentAccountId: input.parentAccountId || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "chart_of_accounts",
    recordId: id,
    action: "UPDATE",
    oldValues: { code: existing.code, name: existing.name, accountType: existing.accountType },
    newValues: { code: updated.code, name: updated.name, accountType: updated.accountType },
  });

  return updated;
}

/**
 * Deactivation is blocked for a system-protected control account (AR/AP/GST,
 * seeded by prisma/seed.ts) and for any account with at least one JournalLine
 * against it — matches the project-wide "cannot deactivate a master with
 * transactional references" rule.
 */
export async function setChartOfAccountActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const existing = await ChartOfAccountRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Account not found.", { id });

  if (!isActive) {
    if (existing.isSystemAccount) {
      throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `"${existing.name}" is a system account and cannot be deactivated.`, {
        id,
      });
    }
    const referenceCount = await ChartOfAccountRepository.countJournalLineReferences(id);
    if (referenceCount > 0) {
      throw new BusinessRuleError(
        "REFERENCED_RECORD_IN_USE",
        `"${existing.name}" has ${referenceCount} journal line(s) posted against it and cannot be deactivated.`,
        { id, referenceCount }
      );
    }
  }

  const updated = await ChartOfAccountRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "chart_of_accounts",
    recordId: id,
    action: "UPDATE",
    oldValues: { isActive: existing.isActive },
    newValues: { isActive },
  });

  return updated;
}

export async function getAccountLedger(companyId: string, accountId: string, dateFrom?: string, dateTo?: string) {
  const account = await ChartOfAccountRepository.findAnyById(companyId, accountId);
  if (!account) throw new BusinessRuleError("NOT_FOUND", "Account not found.", { id: accountId });

  const lines = await ChartOfAccountRepository.findLedgerLines(
    companyId,
    accountId,
    dateFrom ? new Date(dateFrom) : undefined,
    dateTo ? new Date(dateTo) : undefined
  );

  // Normal balance direction: debit-natured accounts (Asset/Expense) increase
  // on debit; credit-natured accounts (Liability/Equity/Income) increase on
  // credit. Running balance shown in the account's own natural direction.
  const isDebitNatured = account.accountType === "ASSET" || account.accountType === "EXPENSE";
  let runningBalance = 0;
  const rows = lines.map((line) => {
    const debit = Number(line.debitAmount);
    const credit = Number(line.creditAmount);
    runningBalance += isDebitNatured ? debit - credit : credit - debit;
    return {
      id: line.id,
      journalNumber: line.journal.journalNumber,
      journalDate: line.journal.journalDate,
      narration: line.journal.narration,
      description: line.description,
      debitAmount: debit,
      creditAmount: credit,
      runningBalance,
    };
  });

  return { account, lines: rows, closingBalance: runningBalance };
}
