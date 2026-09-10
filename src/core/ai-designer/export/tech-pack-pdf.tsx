import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9 },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 12 },
  row: { flexDirection: "row", marginBottom: 12 },
  imageBox: { width: 260, height: 320, marginRight: 20, borderWidth: 1, borderColor: "#ddd" },
  image: { width: "100%", height: "100%", objectFit: "contain" },
  specSection: { flex: 1 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 4, backgroundColor: "#f0f0f0", padding: 3 },
  specRow: { flexDirection: "row", marginBottom: 3 },
  specLabel: { width: 130, fontWeight: 700, color: "#333" },
  specValue: { flex: 1, color: "#000" },
  footer: { position: "absolute", bottom: 15, left: 28, right: 28, fontSize: 7, color: "#888", flexDirection: "row", justifyContent: "space-between" },
});

export interface TechPackSpecItem {
  label: string;
  value: string;
}

export interface TechPackPdfProps {
  projectNumber: string;
  projectName: string;
  imageBase64: string | null;
  imageMimeType: string;
  fabricSpec: TechPackSpecItem[];
  customerProductSpec: TechPackSpecItem[];
  designSpec: TechPackSpecItem[];
  modelEnvironmentSpec: TechPackSpecItem[];
  generatedAt: string;
}

function SpecList({ items }: { items: TechPackSpecItem[] }) {
  return (
    <>
      {items
        .filter((i) => i.value)
        .map((item) => (
          <View key={item.label} style={styles.specRow}>
            <Text style={styles.specLabel}>{item.label}</Text>
            <Text style={styles.specValue}>{item.value}</Text>
          </View>
        ))}
    </>
  );
}

/**
 * AI Designer's own PDF export template ("Export" step) — a new sibling
 * template, not an extension of the table-shaped report/document PDF
 * renderers, which don't fit an image+metadata tech-pack layout. Uses
 * @react-pdf/renderer's own Image component (already a project dependency,
 * confirmed unused-but-supported anywhere else in this repo).
 */
function TechPackDocument(props: TechPackPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{props.projectNumber} — {props.projectName}</Text>
        <Text style={styles.subtitle}>AI Designer — Design Specification Sheet</Text>

        <View style={styles.row}>
          <View style={styles.imageBox}>
            {props.imageBase64 && (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's own Image component, not an HTML <img>; it has no alt prop.
              <Image style={styles.image} src={`data:${props.imageMimeType};base64,${props.imageBase64}`} />
            )}
          </View>
          <View style={styles.specSection}>
            <Text style={styles.sectionTitle}>Fabric</Text>
            <SpecList items={props.fabricSpec} />
            <Text style={styles.sectionTitle}>Customer / Product</Text>
            <SpecList items={props.customerProductSpec} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Design Details</Text>
        <SpecList items={props.designSpec} />

        <Text style={styles.sectionTitle}>Model / Environment</Text>
        <SpecList items={props.modelEnvironmentSpec} />

        <View style={styles.footer} fixed>
          <Text>Generated {props.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderTechPackPdf(props: TechPackPdfProps): Promise<Buffer> {
  return renderToBuffer(<TechPackDocument {...props} />);
}
