import type { ReactNode } from "react";
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

// ---------------------------------------------------------------------------
// Full 7-page Tech Pack download (2026-09-13, v2) — combines the "Generate
// Tech Pack" feature's real, validated Garment Analysis data with its 4
// AI-generated garment-artwork images into one downloadable PDF: every
// table/header/footer/label is real, always-legible PDF text (v1 asked the
// image model to render these itself, which came back as illegible
// pixel-noise on live testing — a confirmed, universal weakness of current
// image-generation models, not a prompt-wording problem). Only pages 1, 2, 4,
// and 5 embed a real generated image (see TECH_PACK_PAGE_DEFINITIONS'
// `needsImage` flag) — pages 3, 6, 7 are pure typeset tables.
// ---------------------------------------------------------------------------

export interface TechPackAnalysisForPdf {
  part1: {
    identification: Record<string, string>;
    construction: Record<string, string>;
    closure: { closureType: string; closureDetails: string };
    seamCallouts: { calloutNumber: number; location: string; technicalSpecification: string; status: string }[];
    visibleColors: { colorName: string; pantoneEstimate: string; hexEstimate: string; garmentPanel: string }[];
    suggestedColorways: {
      colorwayCode: string;
      colorwayName: string;
      mainColor: string;
      contrastColor: string;
      trimColor: string;
      artworkColor: string;
      notes: string;
    }[];
    artworkItems: {
      artworkType: string;
      placement: string;
      scale: string;
      dimensions: string;
      alignment: string;
      printMethod: string;
      distanceFromHps: string;
      distanceFromCf: string;
    }[];
    artworkSummary: string;
    patternPrintType: string;
    patternPrintNotes: string;
  };
  part2: {
    bomItems: { materialType: string; composition: string; gsm: string; color: string; consumption: string; notes: string }[];
    measurementPoints: { pointName: string; howToMeasure: string; toleranceCm: string; values: Record<string, string> }[];
    gradeRulesNotes: string;
    mainLabelSpec: string;
    sizeLabelSpec: string;
    careLabelSpec: string;
    hangtagSpec: string;
    polybagSpec: string;
    foldingInstructions: string;
    cartonPackingSpec: string;
    barcodePlacement: string;
  };
}

export interface TechPackDocumentPageImage {
  pageNumber: number;
  imageBase64: string;
  imageMimeType: string;
}

export interface TechPackDocumentProps {
  projectNumber: string;
  projectName: string;
  generatedAt: string;
  analysis: TechPackAnalysisForPdf;
  designerNotes: string;
  suggestedAdditionalViews: string;
  /** Only the pages that actually have a generated image (1, 2, 4, 5 when present). */
  images: TechPackDocumentPageImage[];
}

const docStyles = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, borderBottomWidth: 1, borderBottomColor: "#000", paddingBottom: 4 },
  headerLeft: { fontSize: 11, fontWeight: 700 },
  headerRight: { fontSize: 9, color: "#555" },
  brandBlock: { fontSize: 8, color: "#555", marginBottom: 8 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 8, marginBottom: 3, backgroundColor: "#eee", padding: 3 },
  table: { borderWidth: 1, borderColor: "#ccc", marginBottom: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd" },
  tableRowLast: { flexDirection: "row" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f5f5f5", borderBottomWidth: 1, borderBottomColor: "#999" },
  th: { flex: 1, padding: 2, fontWeight: 700, fontSize: 7 },
  td: { flex: 1, padding: 2, fontSize: 7 },
  kvRow: { flexDirection: "row", marginBottom: 2 },
  kvLabel: { width: 110, fontWeight: 700, color: "#333" },
  kvValue: { flex: 1 },
  swatch: { width: 8, height: 8, marginRight: 3, borderWidth: 0.5, borderColor: "#999" },
  swatchRow: { flexDirection: "row", alignItems: "center" },
  artworkImageBox: { width: "100%", height: 220, marginBottom: 6, borderWidth: 1, borderColor: "#ccc", alignItems: "center", justifyContent: "center" },
  artworkImage: { width: "100%", height: "100%", objectFit: "contain" },
  footer: { position: "absolute", bottom: 12, left: 24, right: 24, fontSize: 6, color: "#888", flexDirection: "row", justifyContent: "space-between" },
  footerItalic: { fontStyle: "italic" },
  notesText: { fontSize: 7, lineHeight: 1.4 },
});

function PageChrome({
  pageNumber,
  title,
  projectNumber,
  projectName,
  generatedAt,
  children,
}: {
  pageNumber: number;
  title: string;
  projectNumber: string;
  projectName: string;
  generatedAt: string;
  children: ReactNode;
}) {
  return (
    <Page size="A4" style={docStyles.page}>
      <View style={docStyles.headerRow}>
        <Text style={docStyles.headerLeft}>
          PAGE {pageNumber} — {title.toUpperCase()}
        </Text>
        <Text style={docStyles.headerRight}>{pageNumber} of 7</Text>
      </View>
      <Text style={docStyles.brandBlock}>
        {projectNumber} — {projectName} · Generated {generatedAt}
      </Text>
      {children}
      <View style={docStyles.footer} fixed>
        <Text style={docStyles.footerItalic}>ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.</Text>
      </View>
    </Page>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <View style={docStyles.table}>
      <View style={docStyles.tableHeaderRow}>
        {headers.map((h) => (
          <Text key={h} style={docStyles.th}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={i === rows.length - 1 ? docStyles.tableRowLast : docStyles.tableRow}>
          {row.map((cell, j) => (
            <Text key={j} style={docStyles.td}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function KeyValueList({ items }: { items: [string, string][] }) {
  return (
    <>
      {items.map(([label, value]) => (
        <View key={label} style={docStyles.kvRow}>
          <Text style={docStyles.kvLabel}>{label}</Text>
          <Text style={docStyles.kvValue}>{value}</Text>
        </View>
      ))}
    </>
  );
}

const HEX_PATTERN = /#([0-9A-Fa-f]{6})\b/;

function ArtworkImage({ image }: { image: TechPackDocumentPageImage | undefined }) {
  if (!image) return null;
  return (
    <View style={docStyles.artworkImageBox}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's own Image component, not an HTML <img>; it has no alt prop. */}
      <Image style={docStyles.artworkImage} src={`data:${image.imageMimeType};base64,${image.imageBase64}`} />
    </View>
  );
}

function TechPackFullDocument({ projectNumber, projectName, generatedAt, analysis, designerNotes, suggestedAdditionalViews, images }: TechPackDocumentProps) {
  const { part1, part2 } = analysis;
  const imageFor = (pageNumber: number) => images.find((i) => i.pageNumber === pageNumber);
  const chrome = (pageNumber: number, title: string, children: ReactNode) => (
    <PageChrome key={pageNumber} pageNumber={pageNumber} title={title} projectNumber={projectNumber} projectName={projectName} generatedAt={generatedAt}>
      {children}
    </PageChrome>
  );

  return (
    <Document>
      {chrome(
        1,
        "Cover Page / Style Summary",
        <>
          <ArtworkImage image={imageFor(1)} />
          <Text style={docStyles.sectionTitle}>Style Info</Text>
          <KeyValueList
            items={[
              ["Brand", part1.identification.brandName],
              ["Style Name", part1.identification.styleName],
              ["Style Number", part1.identification.styleNumber],
              ["Category", `${part1.identification.garmentCategory} — ${part1.identification.subCategory}`],
              ["Fit Type", part1.identification.fitType],
              ["Gender / Category", part1.identification.genderCategory],
              ["Target Season", part1.identification.targetSeason],
              ["Base Sample Size", part1.identification.baseSampleSize],
              ["Designer", part1.identification.designer],
              ["Date Created", part1.identification.dateCreated],
            ]}
          />
          <Text style={docStyles.sectionTitle}>Key Specs</Text>
          <KeyValueList
            items={[
              ["Silhouette", part1.construction.silhouette],
              ["Body Length", part1.construction.bodyLength],
              ["Closure", part1.closure.closureType],
            ]}
          />
        </>
      )}

      {chrome(
        2,
        "Construction & Detail Callouts",
        <>
          <ArtworkImage image={imageFor(2)} />
          <Text style={docStyles.sectionTitle}>Construction Legend</Text>
          <DataTable
            headers={["#", "Location", "Technical Specification", "Status"]}
            rows={part1.seamCallouts.map((c) => [String(c.calloutNumber), c.location, c.technicalSpecification, c.status])}
          />
        </>
      )}

      {chrome(
        3,
        "Bill of Materials / BOM",
        <>
          <Text style={docStyles.sectionTitle}>Bill of Materials</Text>
          <DataTable
            headers={["Material Type", "Composition", "GSM", "Color", "Consumption", "Notes"]}
            rows={part2.bomItems.map((b) => [b.materialType, b.composition, b.gsm, b.color, b.consumption, b.notes])}
          />
        </>
      )}

      {chrome(
        4,
        "Colorways & Artwork Placement",
        <>
          <ArtworkImage image={imageFor(4)} />
          <Text style={docStyles.sectionTitle}>Visible Colors</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.th}>Swatch</Text>
              <Text style={docStyles.th}>Color</Text>
              <Text style={docStyles.th}>Pantone (est.)</Text>
              <Text style={docStyles.th}>HEX (est.)</Text>
              <Text style={docStyles.th}>Panel</Text>
            </View>
            {part1.visibleColors.map((c, i) => {
              const hexMatch = c.hexEstimate.match(HEX_PATTERN);
              return (
                <View key={i} style={i === part1.visibleColors.length - 1 ? docStyles.tableRowLast : docStyles.tableRow}>
                  <View style={{ flex: 1, padding: 2 }}>
                    {hexMatch && <View style={[docStyles.swatch, { backgroundColor: `#${hexMatch[1]}` }]} />}
                  </View>
                  <Text style={docStyles.td}>{c.colorName}</Text>
                  <Text style={docStyles.td}>{c.pantoneEstimate}</Text>
                  <Text style={docStyles.td}>{c.hexEstimate}</Text>
                  <Text style={docStyles.td}>{c.garmentPanel}</Text>
                </View>
              );
            })}
          </View>
          <Text style={docStyles.sectionTitle}>Suggested Commercial Colorways</Text>
          <DataTable
            headers={["Code", "Name", "Main", "Contrast", "Trim", "Artwork", "Notes"]}
            rows={part1.suggestedColorways.map((c) => [c.colorwayCode, c.colorwayName, c.mainColor, c.contrastColor, c.trimColor, c.artworkColor, c.notes])}
          />
          <Text style={docStyles.sectionTitle}>Artwork Reference</Text>
          <DataTable
            headers={["Type", "Placement", "Scale", "Dimensions", "Alignment", "Print Method", "From HPS", "From CF"]}
            rows={part1.artworkItems.map((a) => [a.artworkType, a.placement, a.scale, a.dimensions, a.alignment, a.printMethod, a.distanceFromHps, a.distanceFromCf])}
          />
        </>
      )}

      {chrome(
        5,
        "Measurements & Spec Table",
        <>
          <ArtworkImage image={imageFor(5)} />
          <Text style={docStyles.sectionTitle}>Point-of-Measure Spec Table</Text>
          <DataTable
            headers={["Point", "How to Measure", "Tolerance", ...Object.keys(part2.measurementPoints[0]?.values ?? {})]}
            rows={part2.measurementPoints.map((p) => [p.pointName, p.howToMeasure, p.toleranceCm, ...Object.values(p.values)])}
          />
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        6,
        "Size Grading",
        <>
          <Text style={docStyles.sectionTitle}>Grade Table</Text>
          <DataTable
            headers={["Point", ...Object.keys(part2.measurementPoints[0]?.values ?? {})]}
            rows={part2.measurementPoints.map((p) => [p.pointName, ...Object.values(p.values)])}
          />
          <Text style={docStyles.sectionTitle}>Size Explanation / Fit Notes</Text>
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        7,
        "Labels & Packaging",
        <>
          <Text style={docStyles.sectionTitle}>Labels &amp; Packaging</Text>
          <KeyValueList
            items={[
              ["Main Label", part2.mainLabelSpec],
              ["Size Label", part2.sizeLabelSpec],
              ["Care Label", part2.careLabelSpec],
              ["Hangtag", part2.hangtagSpec],
              ["Polybag", part2.polybagSpec],
              ["Folding Instructions", part2.foldingInstructions],
              ["Carton Packing", part2.cartonPackingSpec],
              ["Barcode Placement", part2.barcodePlacement],
            ]}
          />
        </>
      )}

      <Page size="A4" style={docStyles.page}>
        <View style={docStyles.headerRow}>
          <Text style={docStyles.headerLeft}>NOTES FOR DESIGNER</Text>
          <Text style={docStyles.headerRight}>8 of 8</Text>
        </View>
        <Text style={docStyles.brandBlock}>
          {projectNumber} — {projectName} · Generated {generatedAt}
        </Text>
        <Text style={docStyles.sectionTitle}>Notes for Designer</Text>
        <Text style={docStyles.notesText}>{designerNotes}</Text>
        <Text style={docStyles.sectionTitle}>Suggested Additional Views</Text>
        <Text style={docStyles.notesText}>{suggestedAdditionalViews}</Text>
      </Page>
    </Document>
  );
}

export async function renderTechPackDocumentPdf(props: TechPackDocumentProps): Promise<Buffer> {
  return renderToBuffer(<TechPackFullDocument {...props} />);
}
