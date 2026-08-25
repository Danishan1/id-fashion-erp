import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { getTrialBalance } from "@/modules/accounts/journal.service";
import { getAccountLedger } from "@/modules/accounts/chart-of-account.service";
import { ChartOfAccountRepository } from "@/modules/accounts/chart-of-account.repository";

const CATEGORY = "accounts" as const;

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

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

  const { dateFrom, dateTo } = parseDateRange(filters);
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
      debitAmount: rows.reduce((s, r) => s + r.debitAmount, 0),
      creditAmount: rows.reduce((s, r) => s + r.creditAmount, 0),
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
  const { dateFrom, dateTo } = parseDateRange(filters);
  const lines = await prisma.journalLine.findMany({
    where: {
      journal: {
        companyId,
        status: "POSTED",
        ...(dateFrom || dateTo ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
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
      debitAmount: rows.reduce((s, r) => s + r.debitAmount, 0),
      creditAmount: rows.reduce((s, r) => s + r.creditAmount, 0),
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
  const { dateFrom, dateTo } = parseDateRange(filters);
  const journals = await prisma.journal.findMany({
    where: {
      companyId,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(dateFrom || dateTo ? { journalDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
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
    const totalDebit = j.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalCredit = j.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
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
      totalDebit: rows.reduce((s, r) => s + r.totalDebit, 0),
      totalCredit: rows.reduce((s, r) => s + r.totalCredit, 0),
    },
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
