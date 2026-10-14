import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { GST_STATE_CODES } from "@/lib/gst";

const CREDIT_NOTE_TYPE_LABELS: Record<string, string> = {
  OVERALL_DISCOUNT: "Overall Discount / Allowance",
  PRODUCT_WISE: "Product-Wise Price Reduction",
  PRODUCT_RETURN: "Product Return / Rejection",
};

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#222",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  companyBlock: {
    maxWidth: "58%",
  },
  companyName: {
    fontSize: 14,
    fontWeight: 700,
    color: "#111",
  },
  companyDetail: {
    fontSize: 7.5,
    color: "#555",
    marginTop: 1.5,
  },
  docTitleBlock: {
    alignItems: "flex-end",
    maxWidth: "40%",
  },
  docTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#b91c1c", // Red accent for Credit Note
    letterSpacing: 0.5,
  },
  docNumber: {
    fontSize: 9.5,
    fontWeight: 700,
    marginTop: 2,
    color: "#333",
  },
  docMeta: {
    fontSize: 7.5,
    color: "#555",
    marginTop: 1.5,
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    marginTop: 8,
    marginBottom: 8,
  },
  lightRule: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    marginTop: 6,
    marginBottom: 6,
  },
  partyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  billToBlock: {
    width: "55%",
  },
  supplyBlock: {
    width: "42%",
    alignItems: "flex-end",
  },
  sectionHeading: {
    fontSize: 7,
    color: "#888",
    textTransform: "uppercase",
    fontWeight: 700,
    marginBottom: 2,
  },
  partyName: {
    fontSize: 9.5,
    fontWeight: 700,
    color: "#111",
  },
  partyDetail: {
    fontSize: 7.5,
    color: "#444",
    marginTop: 1,
  },
  metaKeyValue: {
    flexDirection: "row",
    marginTop: 1.5,
  },
  metaKey: {
    fontSize: 7.5,
    color: "#777",
    marginRight: 4,
  },
  metaVal: {
    fontSize: 7.5,
    fontWeight: 700,
    color: "#222",
  },
  invoiceRefBanner: {
    marginTop: 4,
    padding: 6,
    backgroundColor: "#fef2f2",
    borderWidth: 0.5,
    borderColor: "#fecaca",
    borderRadius: 3,
  },
  invoiceRefText: {
    fontSize: 8,
    fontWeight: 700,
    color: "#991b1b",
  },
  invoiceRefSubText: {
    fontSize: 7.5,
    color: "#7f1d1d",
    marginTop: 1,
  },
  table: {
    display: "flex",
    width: "auto",
    marginTop: 6,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  tableHeaderCell: {
    padding: 4,
    fontSize: 7.5,
    fontWeight: 700,
    color: "#333",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  tableCell: {
    padding: 4,
    fontSize: 7.5,
  },
  totalsSection: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  totalsTable: {
    width: "45%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalsLabel: {
    fontSize: 8,
    color: "#555",
  },
  totalsValue: {
    fontSize: 8,
    fontFamily: "Helvetica",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#333",
    paddingTop: 4,
    marginTop: 3,
  },
  grandTotalLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: "#111",
  },
  grandTotalValue: {
    fontSize: 9.5,
    fontWeight: 700,
    color: "#b91c1c",
  },
  reasonBox: {
    marginTop: 10,
    padding: 6,
    backgroundColor: "#f9fafb",
    borderWidth: 0.5,
    borderColor: "#e5e7eb",
    borderRadius: 3,
  },
  reasonHeading: {
    fontSize: 7.5,
    fontWeight: 700,
    color: "#4b5563",
    marginBottom: 2,
  },
  reasonText: {
    fontSize: 7.5,
    color: "#374151",
  },
  signatorySection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    paddingTop: 12,
  },
  signatoryBox: {
    width: "45%",
    alignItems: "flex-end",
  },
  signatoryTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: "#111",
  },
  signatorySpace: {
    height: 36,
  },
  signatoryLabel: {
    fontSize: 7.5,
    color: "#555",
    borderTopWidth: 0.5,
    borderTopColor: "#888",
    paddingTop: 3,
    textAlign: "right",
    width: "100%",
  },
});

function formatIsoDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const str = d instanceof Date ? d.toISOString() : String(d);
  return str.slice(0, 10);
}

function parseAddressJson(raw: unknown): { address?: string; city?: string; state?: string; pinCode?: string } {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { address: raw };
    }
  }
  if (typeof raw === "object") {
    return raw as { address?: string; city?: string; state?: string; pinCode?: string };
  }
  return {};
}

export interface CreditNotePdfData {
  id: string;
  creditNoteNumber: string;
  creditNoteDate: string | Date;
  type: string;
  reason?: string | null;
  totalAmount: number | string;
  status: string;
  createdBy: { fullName: string };
  customInvoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string | Date;
    placeOfSupplyStateCode?: string | null;
    customer: {
      name: string;
      code: string;
      taxRegistrationNo?: string | null;
      billingAddress?: string | null;
      shippingAddress?: string | null;
      city?: string | null;
      pinCode?: string | null;
    };
    invoiceSeries?: { name: string; prefix: string } | null;
  };
  items?: {
    id: string;
    quantity?: number | string | null;
    amount: number | string;
    customInvoiceItem?: {
      id: string;
      itemName: string;
      hsnCode?: string | null;
      unitPrice?: number | string | null;
      gstPercentage?: number | string | null;
    } | null;
  }[];
  company?: {
    name: string;
    legalName?: string | null;
    taxRegistrationNo?: string | null;
    addressJson?: unknown;
  } | null;
}

export function CreditNoteDocument({ creditNote }: { creditNote: CreditNotePdfData }) {
  const company = creditNote.company ?? { name: "Fashion ERP Enterprise", taxRegistrationNo: null, addressJson: null };
  const companyAddr = parseAddressJson(company.addressJson);
  const cust = creditNote.customInvoice.customer;
  const inv = creditNote.customInvoice;
  const totalAmountNum = Number(creditNote.totalAmount) || 0;
  const isCancelled = creditNote.status === "CANCELLED";

  return (
    <Document title={`Credit Note ${creditNote.creditNoteNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            <Text style={styles.companyName}>{company.legalName || company.name}</Text>
            {companyAddr.address && <Text style={styles.companyDetail}>{companyAddr.address}</Text>}
            {(companyAddr.city || companyAddr.state || companyAddr.pinCode) && (
              <Text style={styles.companyDetail}>
                {[companyAddr.city, companyAddr.state, companyAddr.pinCode].filter(Boolean).join(", ")}
              </Text>
            )}
            <Text style={styles.companyDetail}>
              GSTIN / Tax ID: {company.taxRegistrationNo || "Not Specified"}
            </Text>
          </View>

          <View style={styles.docTitleBlock}>
            <Text style={styles.docTitle}>CREDIT NOTE</Text>
            <Text style={styles.docNumber}>#{creditNote.creditNoteNumber}</Text>
            <Text style={styles.docMeta}>Date: {formatIsoDate(creditNote.creditNoteDate)}</Text>
            <Text style={styles.docMeta}>
              Status: {isCancelled ? "CANCELLED" : "ISSUED"}
            </Text>
            <Text style={styles.docMeta}>
              Type: {CREDIT_NOTE_TYPE_LABELS[creditNote.type] ?? creditNote.type}
            </Text>
          </View>
        </View>

        <View style={styles.rule} />

        {/* Original Invoice Reference Banner */}
        <View style={styles.invoiceRefBanner}>
          <Text style={styles.invoiceRefText}>
            Reference Invoice: #{inv.invoiceNumber} (Dated: {formatIsoDate(inv.invoiceDate)})
          </Text>
          {creditNote.reason && (
            <Text style={styles.invoiceRefSubText}>
              Reason for Credit: {creditNote.reason}
            </Text>
          )}
        </View>

        {/* Customer & Supply Details */}
        <View style={[styles.partyRow, { marginTop: 8 }]}>
          <View style={styles.billToBlock}>
            <Text style={styles.sectionHeading}>Party Details</Text>
            <Text style={styles.partyName}>{cust.name} ({cust.code})</Text>
            <Text style={styles.partyDetail}>
              GSTIN / Tax ID: {cust.taxRegistrationNo || "Unregistered (URP)"}
            </Text>
            {cust.billingAddress && <Text style={styles.partyDetail}>{cust.billingAddress}</Text>}
            {(cust.city || cust.pinCode) && (
              <Text style={styles.partyDetail}>
                {[cust.city, cust.pinCode].filter(Boolean).join(" - ")}
              </Text>
            )}
          </View>

          <View style={styles.supplyBlock}>
            <Text style={styles.sectionHeading}>Delivery / Place of Supply</Text>
            <View style={styles.metaKeyValue}>
              <Text style={styles.metaKey}>Place of Supply:</Text>
              <Text style={styles.metaVal}>
                {inv.placeOfSupplyStateCode
                  ? `${inv.placeOfSupplyStateCode} - ${GST_STATE_CODES[inv.placeOfSupplyStateCode] ?? "Other"}`
                  : "Not Specified"}
              </Text>
            </View>
            <View style={styles.metaKeyValue}>
              <Text style={styles.metaKey}>Shipping / Delivery:</Text>
              <Text style={styles.partyDetail}>
                {cust.shippingAddress && cust.shippingAddress !== cust.billingAddress
                  ? cust.shippingAddress
                  : "Same as billing address"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.lightRule} />

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { width: "6%" }]}>#</Text>
            <Text style={[styles.tableHeaderCell, { width: "44%" }]}>Item Description / Particulars</Text>
            <Text style={[styles.tableHeaderCell, { width: "15%" }]}>HSN/SAC</Text>
            <Text style={[styles.tableHeaderCell, { width: "15%", textAlign: "right" }]}>Credited Qty</Text>
            <Text style={[styles.tableHeaderCell, { width: "20%", textAlign: "right" }]}>Credited Amount (₹)</Text>
          </View>

          {(!creditNote.items || creditNote.items.length === 0) ? (
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { width: "6%", color: "#888" }]}>1</Text>
              <Text style={[styles.tableCell, { width: "44%", fontWeight: 700 }]}>
                {creditNote.reason || "Overall Discount / Allowance on Invoice"}
              </Text>
              <Text style={[styles.tableCell, { width: "15%", color: "#666" }]}>—</Text>
              <Text style={[styles.tableCell, { width: "15%", textAlign: "right", color: "#666" }]}>—</Text>
              <Text style={[styles.tableCell, { width: "20%", textAlign: "right", fontWeight: 700 }]}>
                ₹{totalAmountNum.toFixed(2)}
              </Text>
            </View>
          ) : (
            creditNote.items.map((item, index) => {
              const originalItem = item.customInvoiceItem;
              const qty = item.quantity != null ? Number(item.quantity) : null;
              const amt = Number(item.amount) || 0;
              return (
                <View key={item.id} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { width: "6%", color: "#888" }]}>{index + 1}</Text>
                  <Text style={[styles.tableCell, { width: "44%", fontWeight: 700 }]}>
                    {originalItem?.itemName || "Credited Item"}
                  </Text>
                  <Text style={[styles.tableCell, { width: "15%", color: "#666" }]}>
                    {originalItem?.hsnCode || "—"}
                  </Text>
                  <Text style={[styles.tableCell, { width: "15%", textAlign: "right" }]}>
                    {qty != null ? qty.toFixed(2) : "—"}
                  </Text>
                  <Text style={[styles.tableCell, { width: "20%", textAlign: "right", fontWeight: 700 }]}>
                    ₹{amt.toFixed(2)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Totals Section */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsTable}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Total Credit Reduction:</Text>
              <Text style={styles.totalsValue}>₹{totalAmountNum.toFixed(2)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total Credited Value:</Text>
              <Text style={styles.grandTotalValue}>₹{totalAmountNum.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Reason Box */}
        {creditNote.reason && (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonHeading}>Remarks / Reason for Issuance:</Text>
            <Text style={styles.reasonText}>{creditNote.reason}</Text>
          </View>
        )}

        {/* Signatory Block */}
        <View style={styles.signatorySection}>
          <View style={{ width: "50%" }}>
            <Text style={{ fontSize: 7, color: "#777" }}>
              This is a computer-generated credit note adjusting invoice #{inv.invoiceNumber}.
            </Text>
            <Text style={{ fontSize: 7, color: "#777", marginTop: 2 }}>
              Prepared by: {creditNote.createdBy?.fullName || "Staff"}
            </Text>
          </View>
          <View style={styles.signatoryBox}>
            <Text style={styles.signatoryTitle}>For {company.name}</Text>
            <View style={styles.signatorySpace} />
            <Text style={styles.signatoryLabel}>Authorized Signatory</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCreditNotePdfBuffer(creditNote: CreditNotePdfData): Promise<Buffer> {
  const doc = <CreditNoteDocument creditNote={creditNote} />;
  return await renderToBuffer(doc);
}
