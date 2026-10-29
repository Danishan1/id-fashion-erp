import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/**
 * Shared printable-document PDF template (2026-09-05) — distinct from
 * src/core/reports/pdf.tsx's generic flat-table report renderer. A real
 * business document (Sales Order, Purchase Order, Goods Receipt Note, Tax
 * Invoice) has a fixed shape a report table doesn't: a company letterhead, a
 * "Bill To"/"Vendor" party block, a line-items table, and a totals block —
 * this is that shape, built once and reused across every document type
 * rather than one bespoke layout per module.
 */

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: "Helvetica" },
  companyName: { fontSize: 13, fontWeight: 700 },
  companyDetail: { fontSize: 7.5, color: "#555", marginTop: 1 },
  docTitleBlock: { alignItems: "flex-end" },
  docTitle: { fontSize: 13, fontWeight: 700 },
  docNumber: { fontSize: 9, fontWeight: 700, marginTop: 2 },
  docStatus: { fontSize: 7.5, color: "#555", marginTop: 2 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  headerRule: { borderBottomWidth: 1, borderBottomColor: "#333", marginTop: 8, marginBottom: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  partyBlock: { maxWidth: "55%" },
  partyLabel: { fontSize: 7, color: "#888", textTransform: "uppercase" },
  partyName: { fontSize: 9.5, fontWeight: 700, marginTop: 2 },
  partyLine: { fontSize: 7.5, color: "#444", marginTop: 1 },
  metaBlock: { alignItems: "flex-end" },
  metaLine: { fontSize: 7.5, color: "#444", marginTop: 1, flexDirection: "row" },
  metaLabel: { color: "#888", marginRight: 4 },
  table: { display: "flex", width: "auto", marginTop: 4 },
  row: { flexDirection: "row" },
  headerRowCell: { fontWeight: 700, backgroundColor: "#eee", padding: 4, fontSize: 7.5, borderBottomWidth: 1, borderBottomColor: "#333" },
  cell: { padding: 4, fontSize: 7.5, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  totalsBlock: { alignItems: "flex-end", marginTop: 10 },
  totalsRow: { flexDirection: "row", width: 200, justifyContent: "space-between", paddingVertical: 2 },
  totalsRowFinal: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    paddingVertical: 3,
    borderTopWidth: 1,
    borderTopColor: "#333",
    marginTop: 2,
  },
  totalsLabel: { fontSize: 8, color: "#444" },
  totalsValue: { fontSize: 8, fontWeight: 700 },
  footerNote: { fontSize: 7.5, color: "#555", marginTop: 14 },
  footer: {
    position: "absolute",
    bottom: 15,
    left: 28,
    right: 28,
    fontSize: 7,
    color: "#888",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export interface DocumentColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Optional share of the row, e.g. "30%". Columns without one split what is left equally. */
  width?: string;
}

export interface BusinessDocumentDescriptor {
  companyName: string;
  companyDetailLines: string[];
  docTitle: string;
  docNumber: string;
  docDate: string;
  statusLabel?: string;
  partyLabel: string;
  partyName: string;
  partyDetailLines: string[];
  metaLines: { label: string; value: string }[];
  columns: DocumentColumn[];
  rows: Record<string, string>[];
  totalsLines: { label: string; value: string; final?: boolean }[];
  footerNote?: string;
  /** Optional titled text blocks after the totals (e.g. terms, notes). Blank ones are skipped. */
  sections?: { title: string; body: string }[];
  generatedAt: string;
  generatedByName: string;
}

function columnWidth(count: number): string {
  return `${(100 / count).toFixed(4)}%`;
}

function BusinessDocumentPdfBody({ descriptor }: { descriptor: BusinessDocumentDescriptor }) {
  const fixed = descriptor.columns.filter((c) => c.width);
  const usedPercent = fixed.reduce((sum, c) => sum + parseFloat(c.width!), 0);
  const free = descriptor.columns.length - fixed.length;
  const defaultWidth = fixed.length === 0 ? columnWidth(descriptor.columns.length) : `${((100 - usedPercent) / Math.max(free, 1)).toFixed(4)}%`;
  const widthOf = (col: DocumentColumn) => col.width ?? defaultWidth;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.companyName}>{descriptor.companyName}</Text>
            {descriptor.companyDetailLines.map((line, i) => (
              <Text key={i} style={styles.companyDetail}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.docTitleBlock}>
            <Text style={styles.docTitle}>{descriptor.docTitle}</Text>
            <Text style={styles.docNumber}>{descriptor.docNumber}</Text>
            {descriptor.statusLabel ? <Text style={styles.docStatus}>Status: {descriptor.statusLabel}</Text> : null}
          </View>
        </View>

        <View style={styles.headerRule} />

        <View style={styles.infoRow}>
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>{descriptor.partyLabel}</Text>
            <Text style={styles.partyName}>{descriptor.partyName}</Text>
            {descriptor.partyDetailLines.map((line, i) => (
              <Text key={i} style={styles.partyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.metaBlock}>
            <View style={styles.metaLine}>
              <Text style={styles.metaLabel}>Date:</Text>
              <Text>{descriptor.docDate}</Text>
            </View>
            {descriptor.metaLines.map((m, i) => (
              <View key={i} style={styles.metaLine}>
                <Text style={styles.metaLabel}>{m.label}:</Text>
                <Text>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.row} fixed>
            {descriptor.columns.map((col) => (
              <Text key={col.key} style={[styles.headerRowCell, { width: widthOf(col), textAlign: col.align ?? "left" }]}>
                {col.label}
              </Text>
            ))}
          </View>
          {descriptor.rows.map((row, index) => (
            <View style={styles.row} key={index} wrap={false}>
              {descriptor.columns.map((col) => (
                <Text key={col.key} style={[styles.cell, { width: widthOf(col), textAlign: col.align ?? "left" }]}>
                  {row[col.key] ?? ""}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          {descriptor.totalsLines.map((t, i) => (
            <View key={i} style={t.final ? styles.totalsRowFinal : styles.totalsRow}>
              <Text style={styles.totalsLabel}>{t.label}</Text>
              <Text style={styles.totalsValue}>{t.value}</Text>
            </View>
          ))}
        </View>

        {(descriptor.sections ?? [])
          .filter((section) => section.body.trim())
          .map((section, i) => (
            <View key={i} style={{ marginTop: 10 }} wrap={false}>
              <Text style={styles.partyLabel}>{section.title}</Text>
              <Text style={{ fontSize: 7.5, color: "#333", marginTop: 2 }}>{section.body}</Text>
            </View>
          ))}

        {descriptor.footerNote ? <Text style={styles.footerNote}>{descriptor.footerNote}</Text> : null}

        <View style={styles.footer} fixed>
          <Text>
            Generated {descriptor.generatedAt} by {descriptor.generatedByName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderBusinessDocumentPdf(descriptor: BusinessDocumentDescriptor): Promise<Buffer> {
  const buffer = await renderToBuffer(<BusinessDocumentPdfBody descriptor={descriptor} />);
  return Buffer.from(buffer);
}

export function businessDocumentPdfHeaders(fileName: string) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}
