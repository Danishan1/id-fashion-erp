import { Document, Page, Text, View, Svg, Rect, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { encodeCode128 } from "@/core/barcode/code128-encoder";

/**
 * Shared label-printing template for the Barcode Management & Scanning
 * System, Phase 1 (2026-09-29) — Fabric Roll / Production Lot(bundle) /
 * Carton labels all share this one `LabelDescriptor` shape and renderer,
 * mirroring slip-pdf.tsx's own "one shared template, several callers"
 * convention rather than three near-duplicate files.
 *
 * A small physical label (4in x 2.5in, matching a common thermal/A6-style
 * label printer size), not a full A5/A4 page like the existing Slip/
 * Document templates — deliberately compact.
 *
 * Reuses the shared `encodeCode128` (moved here from the AI Designer Tech
 * Pack's own in-PDF barcode, see code128-encoder.ts's own doc comment) and
 * @react-pdf/renderer's own renderer-native Svg/Rect primitives — no new
 * dependency, no DOM/canvas needed server-side.
 */

const LABEL_WIDTH_PT = 288; // 4in
const LABEL_HEIGHT_PT = 180; // 2.5in

const styles = StyleSheet.create({
  page: { padding: 14, fontSize: 8, fontFamily: "Helvetica" },
  companyName: { fontSize: 9, fontWeight: 700 },
  title: { fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  fieldRow: { flexDirection: "row", marginTop: 3 },
  fieldLabel: { width: "42%", fontSize: 7, color: "#555" },
  fieldValue: { width: "58%", fontSize: 8, fontWeight: 700 },
  barcodeBlock: { alignItems: "center", marginTop: 10 },
  codeText: { fontSize: 9, fontWeight: 700, letterSpacing: 1, marginTop: 3 },
  generatedAt: { position: "absolute", bottom: 8, left: 14, right: 14, fontSize: 6, color: "#888" },
});

export interface LabelField {
  label: string;
  value: string;
}

export interface LabelDescriptor {
  companyName: string;
  title: string;
  code: string;
  fields: LabelField[];
  generatedAt: string;
}

function LabelBarcode({ value, moduleWidth = 1.4, height = 32 }: { value: string; moduleWidth?: number; height?: number }) {
  const encoded = encodeCode128(value);
  if (!encoded) {
    return <Text style={styles.codeText}>Barcode unavailable for &quot;{value}&quot;.</Text>;
  }
  const width = encoded.totalModules * moduleWidth;
  return (
    <>
      <Svg width={width} height={height}>
        {encoded.bars.map((bar, i) => (
          <Rect key={i} x={bar.x * moduleWidth} y={0} width={bar.width * moduleWidth} height={height} fill="#000" />
        ))}
      </Svg>
      <Text style={styles.codeText}>{value}</Text>
    </>
  );
}

function BarcodeLabelBody({ descriptor }: { descriptor: LabelDescriptor }) {
  return (
    <Document>
      <Page size={[LABEL_WIDTH_PT, LABEL_HEIGHT_PT]} style={styles.page}>
        <Text style={styles.companyName}>{descriptor.companyName}</Text>
        <Text style={styles.title}>{descriptor.title}</Text>

        {descriptor.fields.map((f, i) => (
          <View key={i} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            <Text style={styles.fieldValue}>{f.value}</Text>
          </View>
        ))}

        <View style={styles.barcodeBlock}>
          <LabelBarcode value={descriptor.code} />
        </View>

        <Text style={styles.generatedAt} fixed>
          Generated {descriptor.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}

function MultiBarcodeLabelBody({ descriptors }: { descriptors: LabelDescriptor[] }) {
  return (
    <Document>
      {descriptors.map((descriptor, index) => (
        <Page key={index} size={[LABEL_WIDTH_PT, LABEL_HEIGHT_PT]} style={styles.page}>
          <Text style={styles.companyName}>{descriptor.companyName}</Text>
          <Text style={styles.title}>{descriptor.title}</Text>

          {descriptor.fields.map((f, i) => (
            <View key={i} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <Text style={styles.fieldValue}>{f.value}</Text>
            </View>
          ))}

          <View style={styles.barcodeBlock}>
            <LabelBarcode value={descriptor.code} />
          </View>

          <Text style={styles.generatedAt} fixed>
            Generated {descriptor.generatedAt}
          </Text>
        </Page>
      ))}
    </Document>
  );
}

export async function renderBarcodeLabelPdf(descriptor: LabelDescriptor): Promise<Buffer> {
  const buffer = await renderToBuffer(<BarcodeLabelBody descriptor={descriptor} />);
  return Buffer.from(buffer);
}

export async function renderMultiBarcodeLabelPdf(descriptors: LabelDescriptor[]): Promise<Buffer> {
  const buffer = await renderToBuffer(<MultiBarcodeLabelBody descriptors={descriptors} />);
  return Buffer.from(buffer);
}

export function barcodeLabelPdfHeaders(fileName: string) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}
