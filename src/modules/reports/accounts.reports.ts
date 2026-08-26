import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { getTrialBalance } from "@/modules/accounts/journal.service";
import { getAccountLedger } from "@/modules/accounts/chart-of-account.service";
import { ChartOfAccountRepository } from "@/modules/accounts/chart-of-account.repository";
import { parseReportDateRange } from "./report-date-range";
import { validateStatusFilter } from "./report-filters";
import { round2 } from "@/lib/money";
import { JournalStatus } from "@prisma/client";

const CATEGORY = "accounts" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Trial Balance — a thin presentation wrapper over the existing, already-
// tested getTrialBalance() from journal.service.ts. No debit/credit math is
// re-derived here; the row-level numbers and the grand totals below both come
// straight from that function's own return value, so this report is
// guaranteed to reconcile exactly with the existing /accounts/trial-balance
// page for the same "as of" date. This reconciliation is explicitly checked
// during QA — do not change this function to recompute totals from `rows`.
// ---------------------------------------------------------------------------
async function getTrialBalanceDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const asOfDate = filters.asOfDate || filters.dateTo;
  const result = await getTrialBalance(companyId, asOfDate);

  // Filter out rows where both totals are zero — matches the existing
  // /accounts/trial-balance page's own display convention exactly.
  const rows = result.rows
    .filter((r) => r.totalDebit > 0 || r.totalCredit > 0)
    .map((r) => ({
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      accountType: r.accountType,
      totalDebit: r.totalDebit,
      totalCredit: r.totalCredit,
      netBalance: r.netBalance,
    }));

  return {
    title: "Trial Balance",
    subtitle: asOfDate ? `As of ${asOfDate}` : "Per-account debit/credit totals across every posted journal.",
    filtersApplied: filtersApplied(filters, { asOfDate: "As Of Date", dateTo: "As Of Date" }),
    columns: [
      { key: "code", label: "Code", linkTo: "chartOfAccount" },
      { key: "name", label: "Name" },
      { key: "accountType", label: "Account Type" },
      { key: "totalDebit", label: "Debit", type: "currency", align: "right" },
      { key: "totalCredit", label: "Credit", type: "currency", align: "right" },
      { key: "netBalance", label: "Net Balance", type: "currency", align: "right" },
    ],
    rows,
    // MUST always equal getTrialBalance()'s own grandTotalDebit/grandTotalCredit
    // — never recomputed from the (zero-row-filtered) `rows` array above. The
    // result happens to be numerically identical either way (a filtered-out row
    // always contributes 0), but this is written to read directly from the
    // service's own return value so the two can never silently drift apart.
    totals: { totalDebit: result.grandTotalDebit, totalCredit: result.grandTotalCredit },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. General Ledger — a thin presentation wrapper over the existing, already-
// tested getAccountLedger() from chart-of-account.service.ts. Every debit/
// credit/running-balance number below comes directly from that function's own
// return value; nothing here re-derives the ledger math. The one thing
// getAccountLedger()'s own mapped output doesn't carry is each line's parent
// Journal id (needed for this report's drill-down link) — a second, identical
// query (via the same ChartOfAccountRepository.findLedgerLines() the service
// itself calls) fetches just that id and zips it in by index; both calls use
// the exact same where/orderBy, so the two result sets are guaranteed to line
// up positionally.
// ---------------------------------------------------------------------------
async function getGeneralLedgerDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  if (!filters.accountId) {
    return {
      title: "General Ledger",
      subtitle: "Select an account to view its ledger.",
      filtersApplied: [],
      columns: [],
      rows: [],
      generatedAt: new Date().toISOString(),
      generatedByName,
      unavailableReason: "Select an account to view its ledger.",
    };
  }

  // journalDate is @db.Date (see prisma/schema.prisma) — a plain inclusive
  // lte is already correct for it, no dateToExclusive needed here.
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
  const dateTo = filters.dateTo ? new Date(filters.dateTo) : undefined;
  const result = await getAccountLedger(companyId, filters.accountId, filters.dateFrom, filters.dateTo);
  const rawLines = await ChartOfAccountRepository.findLedgerLines(companyId, filters.accountId, dateFrom, dateTo);

  const rows = result.lines.map((line, index) => ({
    journalId: rawLines[index]?.journal.id,
    journalNumber: line.journalNumber,
    journalDate: line.journalDate,
    narration: line.narration ?? line.description ?? "—",
    debitAmount: line.debitAmount,
    creditAmount: line.creditAmount,
    runningBalance: line.runningBalance,
  }));

  return {
    title: "General Ledger",
    subtitle: `Account: ${result.account.code} — ${result.account.name}`,
    filtersApplied: filtersApplied(filters, { accountId: "Account", dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "journalNumber", label: "Journal Number", linkTo: "journal" },
      { key: "journalDate", label: "Journal Date", type: "date" },
      { key: "narration", label: "Narration" },
      { key: "debitAmount", label: "Debit", type: "currency", align: "right" },
      { key: "creditAmount", label: "Credit", type: "currency", align: "right" },
      { key: "runningBalance", label: "Running Balance", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      debitAmount: round2(rows.reduce((s, r) => s + r.debitAmount, 0)),
      creditAmount: round2(rows.reduce((s, r) => s + r.creditAmount, 0)),
      // MUST equal getAccountLedger()'s own closingBalance — never recomputed
      // from the rows above, for the same reconciliation-safety reason as
      // Trial Balance's totals above.
      runningBalance: result.closingBalance,
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Day Book — every POSTED journal line across all accounts, in date order.
// Uses the identical `journal: { companyId, status: "POSTED" }` filtering
// convention as ChartOfAccountRepository.findLedgerLines()/sumPostedLinesByAccount()
// so this reconciles with Trial Balance/General Ledger's own POSTED-only scope.
// ---------------------------------------------------------------------------
async function getDayBookDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const lines = await prisma.journalLine.findMany({
    where: {
      journal: {
        companyId,
        status: "POSTED",
        ...(dateFrom || dateToExclusive ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
      },
    },
    select: {
      debitAmount: true,
      creditAmount: true,
      description: true,
      account: { select: { code: true, name: true } },
      journal: { select: { id: true, journalNumber: true, journalDate: true, narration: true } },
    },
    orderBy: [{ journal: { journalDate: "asc" } }, { journal: { journalNumber: "asc" } }],
  });

  const rows = lines.map((line) => ({
    journalId: line.journal.id,
    journalNumber: line.journal.journalNumber,
    journalDate: line.journal.journalDate,
    account: `${line.account.code} — ${line.account.name}`,
    narration: line.journal.narration ?? line.description ?? "—",
    debitAmount: Number(line.debitAmount),
    creditAmount: Number(line.creditAmount),
  }));

  return {
    title: "Day Book",
    subtitle: "Every posted journal line, in date order, across all accounts.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "journalNumber", label: "Journal Number", linkTo: "journal" },
      { key: "journalDate", label: "Journal Date", type: "date" },
      { key: "account", label: "Account" },
      { key: "narration", label: "Narration" },
      { key: "debitAmount", label: "Debit", type: "currency", align: "right" },
      { key: "creditAmount", label: "Credit", type: "currency", align: "right" },
    ],
    rows,
    // Debit total and Credit total are always equal to each other here — every
    // POSTED journal is balanced by construction (postJournalCore validates
    // this before flipping status), so summing every line's debit/credit
    // across every journal is a natural self-check, not a coincidence.
    totals: {
      debitAmount: round2(rows.reduce((s, r) => s + r.debitAmount, 0)),
      creditAmount: round2(rows.reduce((s, r) => s + r.creditAmount, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Journal Register — one row per Journal (any status, filterable), with
// each journal's own total debit/credit summed live from its own lines.
// Deliberately NOT read from Journal.totalDebit/totalCredit: those columns are
// "written only at post time" (see schema comment on the Journal model), so a
// DRAFT journal would show a misleading 0/0 if this report trusted them
// instead of summing the real, currently-entered lines.
// ---------------------------------------------------------------------------
async function getJournalRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const journals = await prisma.journal.findMany({
    where: {
      companyId,
      ...validateStatusFilter(filters, JournalStatus),
      ...(dateFrom || dateToExclusive ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      journalNumber: true,
      journalDate: true,
      narration: true,
      status: true,
      lines: { select: { debitAmount: true, creditAmount: true } },
    },
    orderBy: [{ journalDate: "desc" }, { journalNumber: "desc" }],
  });

  const rows = journals.map((j) => {
    const totalDebit = round2(j.lines.reduce((s, l) => s + Number(l.debitAmount), 0));
    const totalCredit = round2(j.lines.reduce((s, l) => s + Number(l.creditAmount), 0));
    return {
      journalId: j.id,
      journalNumber: j.journalNumber,
      journalDate: j.journalDate,
      narration: j.narration ?? "—",
      status: j.status,
      totalDebit,
      totalCredit,
    };
  });

  return {
    title: "Journal Register",
    subtitle: "Every Journal matching the selected filters, one row per journal.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", status: "Status" }),
    columns: [
      { key: "journalNumber", label: "Journal Number", linkTo: "journal" },
      { key: "journalDate", label: "Journal Date", type: "date" },
      { key: "narration", label: "Narration" },
      { key: "status", label: "Status" },
      { key: "totalDebit", label: "Total Debit", type: "currency", align: "right" },
      { key: "totalCredit", label: "Total Credit", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      totalDebit: round2(rows.reduce((s, r) => s + r.totalDebit, 0)),
      totalCredit: round2(rows.reduce((s, r) => s + r.totalCredit, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 5. Profit & Loss Statement — POSTED journal lines for INCOME/EXPENSE
// accounts over a period, queried directly (matches Day Book's own
// "POSTED only, direct JournalLine query" convention) rather than via
// getTrialBalance(), since a P&L is period-scoped (dateFrom/dateTo) while
// getTrialBalance() is only ever "as of" a single point in time. Expense
// rows are stored as NEGATIVE amounts specifically so the descriptor's
// totals bar (a plain sum of the Amount column) is exactly Net Profit —
// never a second, separately-computed net-profit figure that could disagree.
// ---------------------------------------------------------------------------
async function getProfitAndLossDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const lines = await prisma.journalLine.findMany({
    where: {
      journal: {
        companyId,
        status: "POSTED",
        ...(dateFrom || dateToExclusive ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
      },
      account: { accountType: { in: ["INCOME", "EXPENSE"] } },
    },
    select: { debitAmount: true, creditAmount: true, account: { select: { code: true, name: true, accountType: true } } },
  });

  interface AccountAgg {
    code: string;
    name: string;
    accountType: "INCOME" | "EXPENSE";
    net: number;
  }
  const byAccount = new Map<string, AccountAgg>();
  for (const line of lines) {
    const key = line.account.code;
    const existing = byAccount.get(key) ?? { code: line.account.code, name: line.account.name, accountType: line.account.accountType as "INCOME" | "EXPENSE", net: 0 };
    const debit = Number(line.debitAmount);
    const credit = Number(line.creditAmount);
    // INCOME is credit-natured (net = credit - debit); EXPENSE is debit-natured (net = debit - credit).
    existing.net += existing.accountType === "INCOME" ? credit - debit : debit - credit;
    byAccount.set(key, existing);
  }

  const incomeAccounts = [...byAccount.values()].filter((a) => a.accountType === "INCOME").sort((a, b) => b.net - a.net);
  const expenseAccounts = [...byAccount.values()].filter((a) => a.accountType === "EXPENSE").sort((a, b) => b.net - a.net);
  const totalIncome = round2(incomeAccounts.reduce((s, a) => s + a.net, 0));
  const totalExpense = round2(expenseAccounts.reduce((s, a) => s + a.net, 0));
  const netProfit = round2(totalIncome - totalExpense);

  const rows = [
    ...incomeAccounts.map((a) => ({ section: "Income", code: a.code, name: a.name, amount: a.net })),
    { section: "Income", code: "", name: "Total Income", amount: totalIncome },
    ...expenseAccounts.map((a) => ({ section: "Expense", code: a.code, name: a.name, amount: -a.net })),
    { section: "Expense", code: "", name: "Total Expense", amount: -totalExpense },
    { section: "Net Profit", code: "", name: "Net Profit (Income − Expense)", amount: netProfit },
  ];

  return {
    title: "Profit & Loss Statement",
    subtitle: "POSTED journal lines for Income/Expense accounts over the selected period. Expense amounts shown as negative so the total below is Net Profit.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "section", label: "Section" },
      { key: "code", label: "Code" },
      { key: "name", label: "Account" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
    ],
    rows,
    // Deliberately NOT a plain reduce over `rows` (that would double-count the
    // Total Income/Total Expense subtotal rows already included above) —
    // this is the one real net profit figure, stated once.
    totals: { amount: netProfit },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 6. Balance Sheet — a thin presentation wrapper over the existing, already-
// tested getTrialBalance(). Assets shown at their natural debit balance;
// Liabilities/Equity sign-flipped to their natural credit balance. This
// project's Chart of Accounts has no period-closing mechanism, so the
// current period's Net Profit (Income − Expense, from the SAME trial
// balance rows) is folded into Equity as real accounting practice requires
// — never a separately-computed figure. The final two rows are a literal,
// checkable statement of the fundamental accounting identity
// (Assets = Liabilities + Equity), verifiable directly from getTrialBalance()'s
// own already-balanced debit/credit totals — not asserted, shown.
// ---------------------------------------------------------------------------
async function getBalanceSheetDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const asOfDate = filters.asOfDate || filters.dateTo;
  const result = await getTrialBalance(companyId, asOfDate);

  const assets = result.rows.filter((r) => r.accountType === "ASSET" && (r.totalDebit > 0 || r.totalCredit > 0));
  const liabilities = result.rows.filter((r) => r.accountType === "LIABILITY" && (r.totalDebit > 0 || r.totalCredit > 0));
  const equity = result.rows.filter((r) => r.accountType === "EQUITY" && (r.totalDebit > 0 || r.totalCredit > 0));
  const income = result.rows.filter((r) => r.accountType === "INCOME");
  const expense = result.rows.filter((r) => r.accountType === "EXPENSE");

  const totalAssets = round2(assets.reduce((s, a) => s + a.netBalance, 0));
  const totalLiabilities = round2(liabilities.reduce((s, a) => s - a.netBalance, 0));
  const totalEquityAccounts = round2(equity.reduce((s, a) => s - a.netBalance, 0));
  const netProfit = round2(income.reduce((s, a) => s - a.netBalance, 0) - expense.reduce((s, a) => s + a.netBalance, 0));
  const totalEquityInclProfit = round2(totalEquityAccounts + netProfit);

  const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquityInclProfit);
  const difference = round2(totalAssets - totalLiabilitiesAndEquity);

  const rows = [
    ...assets.map((a) => ({ section: "Assets", code: a.code, name: a.name, amount: a.netBalance })),
    { section: "Summary", code: "", name: "Total Assets", amount: totalAssets },
    ...liabilities.map((a) => ({ section: "Liabilities", code: a.code, name: a.name, amount: -a.netBalance })),
    { section: "Summary", code: "", name: "Total Liabilities", amount: totalLiabilities },
    ...equity.map((a) => ({ section: "Equity", code: a.code, name: a.name, amount: -a.netBalance })),
    { section: "Equity", code: "", name: "Current Period Net Profit (Income − Expense)", amount: netProfit },
    { section: "Summary", code: "", name: "Total Equity (incl. Net Profit)", amount: totalEquityInclProfit },
    { section: "Summary", code: "", name: "Total Liabilities + Equity", amount: totalLiabilitiesAndEquity },
    { section: "Check", code: "", name: "Difference (Assets − (Liabilities + Equity)) — should be 0", amount: difference },
  ];

  return {
    title: "Balance Sheet",
    subtitle: asOfDate
      ? `As of ${asOfDate}. Current Period Net Profit is folded into Equity (no period-closing mechanism exists in this ERP).`
      : "As of now. Current Period Net Profit is folded into Equity (no period-closing mechanism exists in this ERP).",
    filtersApplied: filtersApplied(filters, { asOfDate: "As Of Date", dateTo: "As Of Date" }),
    columns: [
      { key: "section", label: "Section" },
      { key: "code", label: "Code" },
      { key: "name", label: "Account" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "trial-balance", title: "Trial Balance", buildDescriptor: getTrialBalanceDescriptor });
registerReport({
  category: CATEGORY,
  key: "general-ledger",
  title: "General Ledger",
  buildDescriptor: getGeneralLedgerDescriptor,
  pdfOrientation: "landscape",
});
registerReport({ category: CATEGORY, key: "day-book", title: "Day Book", buildDescriptor: getDayBookDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "journal-register", title: "Journal Register", buildDescriptor: getJournalRegisterDescriptor });
registerReport({ category: CATEGORY, key: "profit-and-loss", title: "Profit & Loss Statement", buildDescriptor: getProfitAndLossDescriptor });
registerReport({ category: CATEGORY, key: "balance-sheet", title: "Balance Sheet", buildDescriptor: getBalanceSheetDescriptor });
