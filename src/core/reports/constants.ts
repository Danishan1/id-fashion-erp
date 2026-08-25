/** Row cap for PDF/Excel exports on large registers/ledgers — mirrors the
 * existing EXPORT_ROW_CAP idiom in stock-balances/export/xlsx/route.ts.
 * PDF gets a tighter cap than Excel since it's meant for summaries and
 * moderate-size registers, not an unbounded ledger. */
export const EXPORT_ROW_CAP_EXCEL = 20000;
export const EXPORT_ROW_CAP_PDF = 2000;
