import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/**
 * Shared shop-floor "slip" PDF template (2026-09-05) — deliberately simpler
 * than document-pdf.tsx's invoice-style layout (no party block, no
 * line-items table, no money totals): a physical work-order ticket meant to
 * travel with a lot/job-work shipment, per this project's own Domain
 * Reference note ("Slip / Production Slip — the physical/digital work-order
 * ticket that moves a lot between stages"). Used today by the Stage
 * Transfer Slip and Job Work Receipt Slip; any future slip-shaped document
 * reuses this same template rather than a bespoke layout.
 */

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
  companyName: { fontSize: 11, fontWeight: 700 },
  titleBlock: { alignItems: "center", marginTop: 14, marginBottom: 14 },
  slipTitle: { fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 },
  slipNumber: { fontSize: 9, color: "#555", marginTop: 3 },
  rule: { borderBottomWidth: 1, borderBottomColor: "#333", marginBottom: 14 },
  fieldRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 6 },
  fieldLabel: { width: "40%", fontSize: 8.5, color: "#666" },
  fieldValue: { width: "60%", fontSize: 9.5, fontWeight: 700 },
  notesBlock: { marginTop: 16 },
  notesLabel: { fontSize: 8, color: "#666", textTransform: "uppercase" },
  notesText: { fontSize: 9, marginTop: 4 },
  signatureBlock: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  signatureLine: { width: "40%", borderTopWidth: 1, borderTopColor: "#333", paddingTop: 4, fontSize: 8, color: "#666", textAlign: "center" },
  footer: {
    position: "absolute",
    bottom: 15,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#888",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export interface SlipField {
  label: string;
  value: string;
}

export interface SlipDescriptor {
  companyName: string;
  slipTitle: string;
  slipNumber: string;
  fields: SlipField[];
  notes?: string | null;
  signatureLabels: [string, string];
  generatedAt: string;
  generatedByName: string;
}

function SlipPdfBody({ descriptor }: { descriptor: SlipDescriptor }) {
  return (
    <Document>
      <Page size="A5" style={styles.page}>
        <Text style={styles.companyName}>{descriptor.companyName}</Text>

        <View style={styles.titleBlock}>
          <Text style={styles.slipTitle}>{descriptor.slipTitle}</Text>
          <Text style={styles.slipNumber}>{descriptor.slipNumber}</Text>
        </View>

        <View style={styles.rule} />

        {descriptor.fields.map((f, i) => (
          <View key={i} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            <Text style={styles.fieldValue}>{f.value}</Text>
          </View>
        ))}

        {descriptor.notes ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{descriptor.notes}</Text>
          </View>
        ) : null}

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLine}>{descriptor.signatureLabels[0]}</Text>
          <Text style={styles.signatureLine}>{descriptor.signatureLabels[1]}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            Generated {descriptor.generatedAt} by {descriptor.generatedByName}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderSlipPdf(descriptor: SlipDescriptor): Promise<Buffer> {
  const buffer = await renderToBuffer(<SlipPdfBody descriptor={descriptor} />);
  return Buffer.from(buffer);
}

export function slipPdfHeaders(fileName: string) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}
