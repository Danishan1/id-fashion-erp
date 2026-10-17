import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { GST_STATE_CODES } from "@/lib/gst";
import {
  getDerivedCustomInvoiceStatus,
  CUSTOM_INVOICE_STATUS_LABELS,
} from "./custom-invoice-status";

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
    color: "#111",
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
  rcmNotice: {
    marginTop: 4,
    padding: 3,
    backgroundColor: "#f9f9f9",
    borderWidth: 0.5,
    borderColor: "#ccc",
    fontSize: 7,
    fontWeight: 700,
    color: "#b45309",
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
    color: "#333",
  },
  bottomSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    alignItems: "flex-start",
  },
  leftNotesBlock: {
    width: "52%",
  },
  totalsBlock: {
    width: "44%",
    alignItems: "flex-end",
  },
  totalsRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    paddingVertical: 1.5,
  },
  totalsRowFinal: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderTopWidth: 1,
    borderTopColor: "#333",
    marginTop: 2,
  },
  totalsRowBalance: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderTopWidth: 1,
    borderTopColor: "#4f46e5",
    borderBottomWidth: 1,
    borderBottomColor: "#4f46e5",
    marginTop: 3,
  },
  totalsLabel: {
    fontSize: 8,
    color: "#555",
  },
  totalsValue: {
    fontSize: 8,
    fontWeight: 700,
    color: "#111",
  },
  bankBox: {
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
    padding: 6,
    borderRadius: 3,
    backgroundColor: "#f8fafc",
    marginBottom: 6,
  },
  bankTitle: {
    fontSize: 7.5,
    fontWeight: 700,
    color: "#334155",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  bankRow: {
    fontSize: 7,
    color: "#475569",
    marginTop: 1,
  },
  notesBox: {
    marginTop: 4,
  },
  notesTitle: {
    fontSize: 7,
    fontWeight: 700,
    color: "#666",
    textTransform: "uppercase",
  },
  notesText: {
    fontSize: 7,
    color: "#444",
    marginTop: 1.5,
    lineHeight: 1.25,
  },
  signatorySection: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 24,
  },
  signatoryBox: {
    width: "40%",
    alignItems: "center",
  },
  signatoryFor: {
    fontSize: 7.5,
    color: "#444",
    marginBottom: 35,
    textAlign: "center",
  },
  signatoryLine: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#333",
    paddingTop: 3,
    fontSize: 7.5,
    fontWeight: 700,
    color: "#333",
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 28,
    right: 28,
    fontSize: 7,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    paddingTop: 4,
  },
});

export interface CustomInvoicePdfData {
  company: {
    name: string;
    legalName: string | null;
    taxRegistrationNo: string | null;
    addressLine: string | null;
    branchName?: string | null;
  };
  customer: {
    name: string;
    code: string;
    taxRegistrationNo: string | null;
    billingAddress: string | null;
    shippingAddress?: string | null;
    city: string | null;
    pinCode: string | null;
    country: string | null;
  };
  invoice: {
    invoiceNumber: string;
    invoiceDate: string;
    status?: string;
    hasDueDate: boolean;
    dueDate: string | null;
    invoiceType: "TAX_INVOICE" | "PROFORMA_INVOICE";
    seriesName: string;
    isReverseCharge: boolean;
    placeOfSupplyStateCode: string | null;
    isInterState: boolean | null;
    subtotalAmount: number;
    discountPercentage: number;
    discountAmount: number;
    taxAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    grandTotal: number;
    advancePaymentAmount: number | null;
    advancePaymentTitle: string | null;
    payableAmountValue: number | null;
    payableAmountTitle: string | null;
    paidAmount: number;
    creditedAmount: number;
    balanceDue: number;
    notes: string[];
    termsAndConditions: string | null;
  };
  items: Array<{
    itemName: string;
    hsnCode: string | null;
    quantity: number;
    unitPrice: number;
    gstPercentage: number;
    lineAmount: number;
    lineTaxAmount: number;
    lineTotal: number;
  }>;
  bankAccount?: {
    bankName: string;
    accountHolderName: string | null;
    accountNumber: string;
    ifscCode: string | null;
    branch: string | null;
    upiId: string | null;
  } | null;
  generatedAt: string;
  generatedByName: string;
}

function formatInr(val: number): string {
  return `INR ${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CustomInvoicePdfDocument({ data }: { data: CustomInvoicePdfData }) {
  const { company, customer, invoice, items, bankAccount } = data;
  const isTaxInvoice = invoice.invoiceType === "TAX_INVOICE";
  const docTitle = isTaxInvoice ? "TAX INVOICE" : "PROFORMA INVOICE";

  // Resolve state name for place of supply
  const posCode = invoice.placeOfSupplyStateCode;
  const posName = posCode ? (GST_STATE_CODES[posCode] ? `${posCode} - ${GST_STATE_CODES[posCode]}` : posCode) : null;

  // Resolve derived status label
  const derivedStatus = getDerivedCustomInvoiceStatus({
    status: invoice.status ?? "DRAFT",
    balanceDue: invoice.balanceDue,
    paidAmount: invoice.paidAmount,
    creditedAmount: invoice.creditedAmount,
    grandTotal: invoice.grandTotal,
  });
  const derivedStatusLabel = CUSTOM_INVOICE_STATUS_LABELS[derivedStatus] ?? derivedStatus;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.companyBlock}>
            <Text style={styles.companyName}>{company.legalName ?? company.name}</Text>
            {company.addressLine && <Text style={styles.companyDetail}>{company.addressLine}</Text>}
            {company.taxRegistrationNo && (
              <Text style={styles.companyDetail}>GSTIN: {company.taxRegistrationNo}</Text>
            )}
            {company.branchName && <Text style={styles.companyDetail}>Branch: {company.branchName}</Text>}
          </View>
          <View style={styles.docTitleBlock}>
            <Text style={styles.docTitle}>{docTitle}</Text>
            <Text style={styles.docNumber}>{invoice.invoiceNumber}</Text>
            <Text style={styles.docMeta}>Date: {invoice.invoiceDate}</Text>
            {invoice.hasDueDate && invoice.dueDate && (
              <Text style={styles.docMeta}>Due Date: {invoice.dueDate}</Text>
            )}
            <Text style={styles.docMeta}>Series: {invoice.seriesName}</Text>
            <Text style={styles.docMeta}>Status: {derivedStatusLabel}</Text>
          </View>
        </View>

        <View style={styles.rule} />

        {/* Bill To & Place of Supply */}
        <View style={styles.partyRow}>
          <View style={styles.billToBlock}>
            <Text style={styles.sectionHeading}>Bill To (Buyer)</Text>
            <Text style={styles.partyName}>{customer.name} ({customer.code})</Text>
            {customer.billingAddress && <Text style={styles.partyDetail}>{customer.billingAddress}</Text>}
            {(customer.city || customer.pinCode) && (
              <Text style={styles.partyDetail}>
                {[customer.city, customer.pinCode].filter(Boolean).join(" - ")}
              </Text>
            )}
            {customer.country && <Text style={styles.partyDetail}>{customer.country}</Text>}
            <Text style={styles.partyDetail}>
              GSTIN: {customer.taxRegistrationNo ?? "Unregistered (URP)"}
            </Text>
            {customer.shippingAddress && customer.shippingAddress !== customer.billingAddress && (
              <View style={{ marginTop: 3 }}>
                <Text style={[styles.sectionHeading, { fontSize: 6.5, marginBottom: 1 }]}>Ship To (Delivery):</Text>
                <Text style={styles.partyDetail}>{customer.shippingAddress}</Text>
              </View>
            )}
          </View>

          <View style={styles.supplyBlock}>
            <Text style={styles.sectionHeading}>Tax & Supply Details</Text>
            <View style={styles.metaKeyValue}>
              <Text style={styles.metaKey}>Place of Supply:</Text>
              <Text style={styles.metaVal}>{posName ?? "Not Specified"}</Text>
            </View>
            <View style={styles.metaKeyValue}>
              <Text style={styles.metaKey}>Tax Type:</Text>
              <Text style={styles.metaVal}>
                {invoice.isInterState === false
                  ? "Intra-State (CGST + SGST)"
                  : invoice.isInterState === true
                  ? "Inter-State (IGST)"
                  : "Unclassified (Legacy)"}
              </Text>
            </View>
            <View style={styles.metaKeyValue}>
              <Text style={styles.metaKey}>Reverse Charge:</Text>
              <Text style={styles.metaVal}>{invoice.isReverseCharge ? "Yes" : "No"}</Text>
            </View>
            {invoice.isReverseCharge && (
              <Text style={styles.rcmNotice}>Tax payable on Reverse Charge basis: YES</Text>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow} fixed>
            <Text style={[styles.tableHeaderCell, { width: "30%" }]}>Item Description</Text>
            <Text style={[styles.tableHeaderCell, { width: "12%", textAlign: "center" }]}>HSN/SAC</Text>
            <Text style={[styles.tableHeaderCell, { width: "8%", textAlign: "right" }]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, { width: "14%", textAlign: "right" }]}>Unit Price</Text>
            <Text style={[styles.tableHeaderCell, { width: "10%", textAlign: "right" }]}>GST %</Text>
            <Text style={[styles.tableHeaderCell, { width: "12%", textAlign: "right" }]}>Tax Amt</Text>
            <Text style={[styles.tableHeaderCell, { width: "14%", textAlign: "right" }]}>Line Total</Text>
          </View>

          {items.map((it, idx) => (
            <View style={styles.tableRow} key={idx} wrap={false}>
              <Text style={[styles.tableCell, { width: "30%" }]}>{it.itemName}</Text>
              <Text style={[styles.tableCell, { width: "12%", textAlign: "center" }]}>{it.hsnCode ?? "—"}</Text>
              <Text style={[styles.tableCell, { width: "8%", textAlign: "right" }]}>{it.quantity}</Text>
              <Text style={[styles.tableCell, { width: "14%", textAlign: "right" }]}>{formatInr(it.unitPrice)}</Text>
              <Text style={[styles.tableCell, { width: "10%", textAlign: "right" }]}>{it.gstPercentage}%</Text>
              <Text style={[styles.tableCell, { width: "12%", textAlign: "right" }]}>{formatInr(it.lineTaxAmount)}</Text>
              <Text style={[styles.tableCell, { width: "14%", textAlign: "right" }]}>{formatInr(it.lineTotal)}</Text>
            </View>
          ))}
        </View>

        {/* Bottom Section: Notes/Bank on Left, Totals on Right */}
        <View style={styles.bottomSection}>
          <View style={styles.leftNotesBlock}>
            {/* Bank details (rendered strictly if exactly 1 active account configured) */}
            {bankAccount && (
              <View style={styles.bankBox} wrap={false}>
                <Text style={styles.bankTitle}>Bank Details for Remittance</Text>
                <Text style={styles.bankRow}>Bank Name: {bankAccount.bankName}</Text>
                {bankAccount.accountHolderName && (
                  <Text style={styles.bankRow}>A/C Holder: {bankAccount.accountHolderName}</Text>
                )}
                <Text style={styles.bankRow}>A/C Number: {bankAccount.accountNumber}</Text>
                {bankAccount.ifscCode && <Text style={styles.bankRow}>IFSC Code: {bankAccount.ifscCode}</Text>}
                {bankAccount.branch && <Text style={styles.bankRow}>Branch: {bankAccount.branch}</Text>}
                {bankAccount.upiId && <Text style={styles.bankRow}>UPI ID: {bankAccount.upiId}</Text>}
              </View>
            )}

            {invoice.notes.length > 0 && (
              <View style={styles.notesBox} wrap={false}>
                <Text style={styles.notesTitle}>Notes</Text>
                {invoice.notes.map((n, i) => (
                  <Text key={i} style={styles.notesText}>• {n}</Text>
                ))}
              </View>
            )}

            {invoice.termsAndConditions && (
              <View style={styles.notesBox} wrap={false}>
                <Text style={styles.notesTitle}>Terms & Conditions</Text>
                <Text style={styles.notesText}>{invoice.termsAndConditions}</Text>
              </View>
            )}
          </View>

          <View style={styles.totalsBlock} wrap={false}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal (Taxable):</Text>
              <Text style={styles.totalsValue}>{formatInr(invoice.subtotalAmount)}</Text>
            </View>

            {invoice.discountAmount > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>
                  Discount ({invoice.discountPercentage}%):
                </Text>
                <Text style={styles.totalsValue}>− {formatInr(invoice.discountAmount)}</Text>
              </View>
            )}

            {/* Tax breakdown strictly according to confirmed semantics */}
            {invoice.isInterState === false ? (
              <>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>CGST:</Text>
                  <Text style={styles.totalsValue}>{formatInr(invoice.cgstAmount)}</Text>
                </View>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>SGST:</Text>
                  <Text style={styles.totalsValue}>{formatInr(invoice.sgstAmount)}</Text>
                </View>
              </>
            ) : invoice.isInterState === true ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>IGST:</Text>
                <Text style={styles.totalsValue}>{formatInr(invoice.igstAmount)}</Text>
              </View>
            ) : (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Total Tax (Unclassified):</Text>
                <Text style={styles.totalsValue}>{formatInr(invoice.taxAmount)}</Text>
              </View>
            )}

            <View style={styles.totalsRowFinal}>
              <Text style={[styles.totalsLabel, { fontWeight: 700, color: "#111" }]}>Grand Total:</Text>
              <Text style={[styles.totalsValue, { fontSize: 9 }]}>{formatInr(invoice.grandTotal)}</Text>
            </View>

            {Number(invoice.advancePaymentAmount) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{invoice.advancePaymentTitle ?? "Advance Payment"}:</Text>
                <Text style={styles.totalsValue}>− {formatInr(Number(invoice.advancePaymentAmount))}</Text>
              </View>
            )}

            {Number(invoice.payableAmountValue) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{invoice.payableAmountTitle ?? "Deductions"}:</Text>
                <Text style={styles.totalsValue}>− {formatInr(Number(invoice.payableAmountValue))}</Text>
              </View>
            )}

            {Number(invoice.paidAmount) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Paid Amount:</Text>
                <Text style={styles.totalsValue}>− {formatInr(Number(invoice.paidAmount))}</Text>
              </View>
            )}

            {Number(invoice.creditedAmount) > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Credit Notes:</Text>
                <Text style={styles.totalsValue}>− {formatInr(Number(invoice.creditedAmount))}</Text>
              </View>
            )}

            <View style={styles.totalsRowBalance}>
              <Text style={[styles.totalsLabel, { fontWeight: 700, color: "#111" }]}>Balance Due:</Text>
              <Text style={[styles.totalsValue, { fontSize: 9, color: "#4f46e5" }]}>
                {formatInr(Number(invoice.balanceDue))}
              </Text>
            </View>
          </View>
        </View>

        {/* Authorized Signatory Block */}
        <View style={styles.signatorySection} wrap={false}>
          <View style={styles.signatoryBox}>
            <Text style={styles.signatoryFor}>For {company.legalName ?? company.name}</Text>
            <Text style={styles.signatoryLine}>Authorized Signatory</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Generated on {data.generatedAt} by {data.generatedByName}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCustomInvoicePdf(data: CustomInvoicePdfData): Promise<Buffer> {
  const buffer = await renderToBuffer(<CustomInvoicePdfDocument data={data} />);
  return Buffer.from(buffer);
}

export function customInvoicePdfHeaders(fileName: string, disposition: "attachment" | "inline" = "attachment") {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${encodeURIComponent(fileName)}"`,
  };
}
