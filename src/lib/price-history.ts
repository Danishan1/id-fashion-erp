export interface PurchaseHistoryEntry {
  id: string;
  unitPrice: number;
  receivedDate: string;
  receiptNumber: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
}

export interface SalesPriceHistoryEntry {
  unitPrice: number;
  orderNumber: string;
  orderDate: string;
}

/** One datalist option per distinct price actually paid/charged — entries
 * arrive most-recent-first (see getMaterialRateHistory / getSalesOrderPriceHistory),
 * so keeping the FIRST occurrence per price (not the last) is what surfaces
 * the most recent supplier/order for a repeated price. Shared by every
 * "Unit Price" field that offers real price history as suggestions —
 * purchase-side (Material Request's Generate Purchase Order(s) modal, the
 * standalone Purchase Order form) and sales-side (the Sales Order form) —
 * so they can never drift into two different dedupe rules. Generic over the
 * entry shape since the two sides carry genuinely different context fields
 * (supplier+received date vs. order number+order date). */
export function dedupePriceOptions<T extends { unitPrice: number }>(entries: T[]): T[] {
  const seen = new Map<number, T>();
  for (const entry of entries) {
    if (!seen.has(entry.unitPrice)) seen.set(entry.unitPrice, entry);
  }
  return [...seen.values()];
}
