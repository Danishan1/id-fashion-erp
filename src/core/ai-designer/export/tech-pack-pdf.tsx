import type { ReactNode } from "react";
import { Document, Page, Text, View, Image, Svg, Rect, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import {
  CALLOUT_BOX_HEIGHT_PT,
  CALLOUT_BOX_WIDTH_PT,
  computeContainFitRect,
  computeGradeRules,
  findColorHexForBomRow,
  mapCalloutPositionToBoxPercent,
  resolveColorHex,
  tryParseNumberedSteps,
} from "./tech-pack-format";
import { encodeCode128 } from "@/core/barcode/code128-encoder";

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
 * confirmed unused-but-supported anywhere else in this repo). Deliberately
 * untouched by the 2026-09-20 Tech Pack redesign below — this is a distinct,
 * simpler single-page "spec sheet" triggered from a different UI step.
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
// Full Tech Pack download — combines the "Generate Tech Pack" feature's
// real, validated Garment Analysis data with its real design photo/technical
// flat into one downloadable, professional multi-page PDF. Every table/
// header/footer/label is real, always-legible PDF text/vector graphics —
// never AI-drawn (see the doc comment on generateTechPack in
// ai-designer.service.ts for the full history of that decision).
//
// 2026-09-20 redesign: dynamic page numbering (was hardcoded "X of 7" on an
// 8-page document — a real bug), a letterhead header, real-app-data
// preference over AI-guessed Style Info fields, real color swatch chips
// (Visible Colors / Suggested Colorways / BOM), numbered pins on Page 2's
// construction-callout image (AI-estimated positions, graceful when absent),
// a genuinely DERIVED Grade Rule table on Page 6 (was a verbatim duplicate
// of Page 5), schematic label/hangtag/carton mockups plus a real scannable
// CODE128 barcode on Page 7 (encodes the project number — this codebase's
// only in-PDF barcode; the browser-only Barcode.tsx component cannot run
// inside @react-pdf/renderer's server-side render).
// ---------------------------------------------------------------------------

export interface TechPackAnalysisForPdf {
  part1: {
    identification: Record<string, string>;
    construction: Record<string, string>;
    closure: { closureType: string; closureDetails: string };
    seamCallouts: { calloutNumber: number; location: string; technicalSpecification: string; status: string; xPercent?: number; yPercent?: number }[];
    visibleColors: { colorName: string; pantoneEstimate: string; hexEstimate: string; garmentPanel: string }[];
    suggestedColorways: {
      colorwayCode: string;
      colorwayName: string;
      mainColor: string;
      contrastColor: string;
      trimColor: string;
      artworkColor: string;
      notes: string;
      mainColorHex?: string;
      contrastColorHex?: string;
      trimColorHex?: string;
      artworkColorHex?: string;
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

/** Real, already-known app data preferred over an AI-guessed identification field wherever an equivalent exists — see exportTechPackPdf() in ai-designer.service.ts for exactly how each is sourced. Fields with no real-app equivalent (Target Season, Base Sample Size, Fit Type) are deliberately absent here and keep reading from analysis.part1.identification instead. */
export interface TechPackRealStyleInfo {
  brandName: string;
  styleName: string;
  styleNumber: string;
  category: string;
  targetCustomer: string;
  designerName: string;
  dateCreated: string;
}

export interface TechPackDocumentProps {
  projectNumber: string;
  projectName: string;
  generatedAt: string;
  analysis: TechPackAnalysisForPdf;
  designerNotes: string;
  suggestedAdditionalViews: string;
  /** One resolved image per page that has one — the SERVICE (ai-designer.service.ts) already decided, per page, whether that's the plain photo or the technical flat (Page 2 is always the plain photo, since that's what the seam-callout xPercent/yPercent were estimated against); the renderer just displays whatever it's given. */
  images: TechPackDocumentPageImage[];
  /**
   * Both optional: the "Replicate Design" sibling feature calls this same
   * renderer with its own, independently-forked schema/prompt (2026-09-14)
   * that has no equivalent real-app-data lookup wired up — extending that is
   * an explicit, separate decision, not bundled into this pass. Omitting
   * both here falls back to exactly the pre-2026-09-20 behavior (a generic
   * company label, every Style Info field sourced from the AI's own
   * identification guess) — every other redesigned page (letterhead layout,
   * dynamic page numbers, swatches, grade rules, Page 7 mockups, barcode)
   * still renders in full either way.
   */
  companyName?: string;
  realStyleInfo?: TechPackRealStyleInfo;
  /** Page 2's own real photo pixel dimensions, so seam-callout pins can be corrected for `objectFit: "contain"` letterboxing (see computeContainFitRect's own doc comment). Undefined when Page 2 has no image or its dimensions couldn't be read — pins are then placed using the raw, uncorrected percentage (only wrong when the photo's aspect ratio differs from the display box's, which is the common case for a portrait photo, so this should be supplied whenever possible). */
  page2ImageDimensions?: { width: number; height: number };
}

const DEFAULT_COMPANY_NAME = "Fashion ERP";

function resolveStyleInfo(analysis: TechPackAnalysisForPdf, realStyleInfo: TechPackRealStyleInfo | undefined): TechPackRealStyleInfo {
  if (realStyleInfo) return realStyleInfo;
  const id = analysis.part1.identification;
  return {
    brandName: id.brandName,
    styleName: id.styleName,
    styleNumber: id.styleNumber,
    category: id.garmentCategory,
    targetCustomer: id.genderCategory,
    designerName: id.designer,
    dateCreated: id.dateCreated,
  };
}

const docStyles = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica" },
  letterheadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  companyRow: { flexDirection: "row", alignItems: "center" },
  companyBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#1F2A44", alignItems: "center", justifyContent: "center", marginRight: 6 },
  companyBadgeText: { color: "#fff", fontSize: 11, fontWeight: 700 },
  companyName: { fontSize: 11, fontWeight: 700 },
  docTitleBlock: { alignItems: "flex-end" },
  docTitle: { fontSize: 11, fontWeight: 700 },
  docPageTitle: { fontSize: 9, color: "#333", marginTop: 1 },
  docMetaLine: { fontSize: 7.5, color: "#555", marginTop: 1 },
  headerRule: { borderBottomWidth: 1, borderBottomColor: "#333", marginBottom: 6 },
  brandBlock: { fontSize: 8, color: "#555", marginBottom: 8 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 8, marginBottom: 3, backgroundColor: "#eee", padding: 3 },
  table: { borderWidth: 1, borderColor: "#ccc", marginBottom: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd" },
  tableRowLast: { flexDirection: "row" },
  tableRowZebra: { backgroundColor: "#fafafa" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f5f5f5", borderBottomWidth: 1, borderBottomColor: "#999" },
  th: { flex: 1, padding: 2, fontWeight: 700, fontSize: 7 },
  td: { flex: 1, padding: 2, fontSize: 7 },
  swatchCol: { flex: 1, padding: 2, alignItems: "flex-start" },
  kvRow: { flexDirection: "row", marginBottom: 2 },
  kvLabel: { width: 110, fontWeight: 700, color: "#333" },
  kvValue: { flex: 1 },
  swatch: { width: 9, height: 9, borderWidth: 0.5, borderColor: "#999" },
  imageCaption: { fontSize: 7, color: "#777", fontStyle: "italic", marginBottom: 2 },
  artworkImageBox: { width: "100%", height: 220, marginBottom: 6, borderWidth: 1, borderColor: "#ccc", alignItems: "center", justifyContent: "center" },
  artworkImage: { width: "100%", height: "100%", objectFit: "contain" },
  calloutImageWrapper: { position: "relative", width: "100%", height: CALLOUT_BOX_HEIGHT_PT, marginBottom: 6 },
  pin: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#C0202C",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -7,
    marginTop: -7,
  },
  pinText: { color: "#fff", fontSize: 7, fontWeight: 700 },
  pinBadgeCell: { flex: 0.4, padding: 2, alignItems: "flex-start" },
  pinBadge: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#C0202C", alignItems: "center", justifyContent: "center" },
  pinBadgeText: { color: "#fff", fontSize: 6, fontWeight: 700 },
  labelMockRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 },
  labelMockBox: { width: "48%", borderWidth: 1, borderColor: "#999", borderStyle: "dashed", padding: 6, marginBottom: 6, marginRight: "2%" },
  labelMockCaption: { fontSize: 6.5, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 2 },
  labelMockText: { fontSize: 7, lineHeight: 1.3 },
  cartonBox: { borderWidth: 1.5, borderColor: "#555", padding: 8, marginBottom: 6 },
  barcodeBox: { borderWidth: 1, borderColor: "#999", padding: 8, alignItems: "center", marginBottom: 4 },
  numberedStep: { flexDirection: "row", marginBottom: 2 },
  numberedStepIndex: { width: 14, fontWeight: 700, fontSize: 7 },
  numberedStepText: { flex: 1, fontSize: 7, lineHeight: 1.3 },
  footer: { position: "absolute", bottom: 12, left: 24, right: 24, fontSize: 6, color: "#888", flexDirection: "row", justifyContent: "space-between" },
  footerItalic: { fontStyle: "italic" },
  notesText: { fontSize: 7, lineHeight: 1.4 },
});

function PageChrome({
  title,
  projectNumber,
  projectName,
  generatedAt,
  companyName,
  realStyleInfo,
  children,
}: {
  title: string;
  projectNumber: string;
  projectName: string;
  generatedAt: string;
  companyName: string;
  realStyleInfo: TechPackRealStyleInfo;
  children: ReactNode;
}) {
  return (
    <Page size="A4" style={docStyles.page}>
      <View style={docStyles.letterheadRow}>
        <View style={docStyles.companyRow}>
          <View style={docStyles.companyBadge}>
            <Text style={docStyles.companyBadgeText}>{(companyName.trim()[0] ?? "?").toUpperCase()}</Text>
          </View>
          <Text style={docStyles.companyName}>{companyName}</Text>
        </View>
        <View style={docStyles.docTitleBlock}>
          <Text style={docStyles.docTitle}>GARMENT TECH PACK — {title.toUpperCase()}</Text>
          <Text style={docStyles.docMetaLine}>
            Style No.: {realStyleInfo.styleNumber} · Date: {realStyleInfo.dateCreated}
          </Text>
          <Text style={docStyles.docMetaLine} render={({ pageNumber: p, totalPages }) => `Page ${p} of ${totalPages}`} />
        </View>
      </View>
      <View style={docStyles.headerRule} />
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

function DataTable({ headers, rows, zebra }: { headers: string[]; rows: string[][]; zebra?: boolean }) {
  return (
    <View style={docStyles.table}>
      <View style={docStyles.tableHeaderRow}>
        {headers.map((h) => (
          <Text key={h} style={docStyles.th}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => {
        const rowStyle = i === rows.length - 1 ? docStyles.tableRowLast : docStyles.tableRow;
        const zebraStyle = zebra && i % 2 === 1 ? docStyles.tableRowZebra : undefined;
        return (
          <View key={i} style={zebraStyle ? [rowStyle, zebraStyle] : rowStyle}>
            {row.map((cell, j) => (
              <Text key={j} style={docStyles.td}>
                {cell}
              </Text>
            ))}
          </View>
        );
      })}
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

function SwatchChip({ hex }: { hex: string | null }) {
  if (!hex) return null;
  return <View style={[docStyles.swatch, { backgroundColor: hex }]} />;
}

function ArtworkImage({ image }: { image: TechPackDocumentPageImage | undefined }) {
  if (!image) return null;
  return (
    <View style={docStyles.artworkImageBox}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's own Image component, not an HTML <img>; it has no alt prop. */}
      <Image style={docStyles.artworkImage} src={`data:${image.imageMimeType};base64,${image.imageBase64}`} />
    </View>
  );
}

/** Renders a real, scannable CODE128 barcode encoding `value` via @react-pdf/renderer's own Svg/Rect primitives — no new dependency, no DOM/canvas needed. Falls back to a plain "not available" note for a value outside CODE128 Subset B's printable-ASCII range (should never actually happen for this app's projectNumber values). */
function Code128Barcode({ value, moduleWidth = 1.6, height = 34 }: { value: string; moduleWidth?: number; height?: number }) {
  const encoded = encodeCode128(value);
  if (!encoded) {
    return (
      <Text style={docStyles.notesText}>
        Barcode unavailable for &quot;{value}&quot;.
      </Text>
    );
  }
  const width = encoded.totalModules * moduleWidth;
  return (
    <>
      <Svg width={width} height={height}>
        {encoded.bars.map((bar, i) => (
          <Rect key={i} x={bar.x * moduleWidth} y={0} width={bar.width * moduleWidth} height={height} fill="#000" />
        ))}
      </Svg>
      <Text style={[docStyles.notesText, { marginTop: 2, letterSpacing: 1 }]}>{value}</Text>
    </>
  );
}

function TechPackFullDocument({
  projectNumber,
  projectName,
  generatedAt,
  analysis,
  designerNotes,
  suggestedAdditionalViews,
  images,
  companyName: companyNameProp,
  realStyleInfo: realStyleInfoProp,
  page2ImageDimensions,
}: TechPackDocumentProps) {
  const { part1, part2 } = analysis;
  const companyName = companyNameProp ?? DEFAULT_COMPANY_NAME;
  const realStyleInfo = resolveStyleInfo(analysis, realStyleInfoProp);
  const imageFor = (pageNumber: number) => images.find((i) => i.pageNumber === pageNumber);
  const chrome = (pageNumber: number, title: string, children: ReactNode) => (
    <PageChrome
      key={pageNumber}
      title={title}
      projectNumber={projectNumber}
      projectName={projectName}
      generatedAt={generatedAt}
      companyName={companyName}
      realStyleInfo={realStyleInfo}
    >
      {children}
    </PageChrome>
  );

  const pinnedCallouts = part1.seamCallouts.filter(
    (c) => typeof c.xPercent === "number" && typeof c.yPercent === "number" && c.xPercent! >= 0 && c.xPercent! <= 100 && c.yPercent! >= 0 && c.yPercent! <= 100
  );
  // The AI estimates a callout's position against the real photo's own
  // pixels, not the fixed-size display box the photo is shown in via
  // `objectFit: "contain"` -- this rect corrects for the letterboxing that
  // introduces (see computeContainFitRect's own doc comment). Falls back to
  // "no letterboxing" when the photo's real dimensions aren't known.
  const calloutImageRect = page2ImageDimensions
    ? computeContainFitRect(page2ImageDimensions.width, page2ImageDimensions.height, CALLOUT_BOX_WIDTH_PT, CALLOUT_BOX_HEIGHT_PT)
    : { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 };
  const gradeRules = computeGradeRules(part2.measurementPoints);
  const foldingSteps = tryParseNumberedSteps(part2.foldingInstructions);

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
              ["Brand", realStyleInfo.brandName],
              ["Style Name", realStyleInfo.styleName],
              ["Style Number", realStyleInfo.styleNumber],
              ["Category", `${realStyleInfo.category} — ${part1.identification.subCategory}`],
              ["Fit Type", part1.identification.fitType],
              ["Gender / Category", realStyleInfo.targetCustomer],
              ["Target Season", part1.identification.targetSeason],
              ["Base Sample Size", part1.identification.baseSampleSize],
              ["Designer", realStyleInfo.designerName],
              ["Date Created", realStyleInfo.dateCreated],
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
          <Text style={docStyles.imageCaption}>Reference: Selected Design Photo — used for construction callouts</Text>
          <View style={docStyles.calloutImageWrapper}>
            <ArtworkImage image={imageFor(2)} />
            {pinnedCallouts.map((c) => {
              const { left, top } = mapCalloutPositionToBoxPercent({ xPercent: c.xPercent!, yPercent: c.yPercent! }, calloutImageRect);
              return (
                <View key={c.calloutNumber} style={[docStyles.pin, { left: `${left}%`, top: `${top}%` }]}>
                  <Text style={docStyles.pinText}>{c.calloutNumber}</Text>
                </View>
              );
            })}
          </View>
          <Text style={docStyles.sectionTitle}>Construction Legend</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.pinBadgeCell}>#</Text>
              <Text style={docStyles.th}>Location</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Technical Specification</Text>
              <Text style={docStyles.th}>Status</Text>
            </View>
            {part1.seamCallouts.map((c, i) => (
              <View key={c.calloutNumber} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <View style={docStyles.pinBadgeCell}>
                  <View style={docStyles.pinBadge}>
                    <Text style={docStyles.pinBadgeText}>{c.calloutNumber}</Text>
                  </View>
                </View>
                <Text style={docStyles.td}>{c.location}</Text>
                <Text style={[docStyles.td, { flex: 2 }]}>{c.technicalSpecification}</Text>
                <Text style={docStyles.td}>{c.status}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {chrome(
        3,
        "Bill of Materials / BOM",
        <>
          <Text style={docStyles.sectionTitle}>Bill of Materials</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.swatchCol}>Swatch</Text>
              <Text style={docStyles.th}>Material Type</Text>
              <Text style={docStyles.th}>Composition</Text>
              <Text style={docStyles.th}>GSM</Text>
              <Text style={docStyles.th}>Color</Text>
              <Text style={docStyles.th}>Consumption</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Notes</Text>
            </View>
            {part2.bomItems.map((b, i) => (
              <View key={i} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <View style={docStyles.swatchCol}>
                  <SwatchChip hex={findColorHexForBomRow(b.color, part1.visibleColors)} />
                </View>
                <Text style={docStyles.td}>{b.materialType}</Text>
                <Text style={docStyles.td}>{b.composition}</Text>
                <Text style={docStyles.td}>{b.gsm}</Text>
                <Text style={docStyles.td}>{b.color}</Text>
                <Text style={docStyles.td}>{b.consumption}</Text>
                <Text style={[docStyles.td, { flex: 2 }]}>{b.notes}</Text>
              </View>
            ))}
          </View>
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
              <Text style={docStyles.swatchCol}>Swatch</Text>
              <Text style={docStyles.th}>Color</Text>
              <Text style={docStyles.th}>Pantone (est.)</Text>
              <Text style={docStyles.th}>HEX (est.)</Text>
              <Text style={docStyles.th}>Panel</Text>
            </View>
            {part1.visibleColors.map((c, i) => (
              <View key={i} style={i === part1.visibleColors.length - 1 ? docStyles.tableRowLast : docStyles.tableRow}>
                <View style={docStyles.swatchCol}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.hexEstimate, colorName: c.colorName })} />
                </View>
                <Text style={docStyles.td}>{c.colorName}</Text>
                <Text style={docStyles.td}>{c.pantoneEstimate}</Text>
                <Text style={docStyles.td}>{c.hexEstimate}</Text>
                <Text style={docStyles.td}>{c.garmentPanel}</Text>
              </View>
            ))}
          </View>
          <Text style={docStyles.sectionTitle}>Suggested Commercial Colorways</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.th}>Code</Text>
              <Text style={docStyles.th}>Name</Text>
              <Text style={docStyles.th}>Main</Text>
              <Text style={docStyles.th}>Contrast</Text>
              <Text style={docStyles.th}>Trim</Text>
              <Text style={docStyles.th}>Artwork</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Notes</Text>
            </View>
            {part1.suggestedColorways.map((c, i) => (
              <View key={i} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <Text style={docStyles.td}>{c.colorwayCode}</Text>
                <Text style={docStyles.td}>{c.colorwayName}</Text>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.mainColorHex, colorName: c.mainColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.mainColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.contrastColorHex, colorName: c.contrastColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.contrastColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.trimColorHex, colorName: c.trimColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.trimColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.artworkColorHex, colorName: c.artworkColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.artworkColor}</Text>
                </View>
                <Text style={[docStyles.td, { flex: 2 }]}>{c.notes}</Text>
              </View>
            ))}
          </View>
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
            zebra
          />
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        6,
        "Size Grading",
        <>
          <Text style={docStyles.sectionTitle}>Grade Rules (derived from the Point-of-Measure chart)</Text>
          <DataTable headers={["Point", "Grade Rule (per size step)"]} rows={gradeRules.map((r) => [r.pointName, r.grade])} zebra />
          <Text style={docStyles.notesText}>
            Grade rule = increment applied per adjacent size step (XS to S to M to L to XL to XXL). &quot;Non-linear&quot; means the increment is not
            consistent across every step — refer to the full Measurements &amp; Spec Table on the previous page.
          </Text>
          <Text style={docStyles.sectionTitle}>Size Explanation / Fit Notes</Text>
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        7,
        "Labels & Packaging",
        <>
          <Text style={docStyles.sectionTitle}>Label & Hangtag Mockups</Text>
          <View style={docStyles.labelMockRow}>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Main Label</Text>
              <Text style={docStyles.labelMockText}>{part2.mainLabelSpec}</Text>
            </View>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Size Label</Text>
              <Text style={docStyles.labelMockText}>{part2.sizeLabelSpec}</Text>
            </View>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Care Label</Text>
              <Text style={docStyles.labelMockText}>{part2.careLabelSpec}</Text>
            </View>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Hangtag</Text>
              <Text style={docStyles.labelMockText}>{part2.hangtagSpec}</Text>
            </View>
          </View>

          <Text style={docStyles.sectionTitle}>Packaging</Text>
          <View style={docStyles.cartonBox}>
            <Text style={docStyles.labelMockCaption}>Carton</Text>
            <Text style={docStyles.labelMockText}>{part2.cartonPackingSpec}</Text>
          </View>
          <Text style={[docStyles.labelMockCaption, { marginBottom: 2 }]}>Polybag</Text>
          <Text style={[docStyles.notesText, { marginBottom: 6 }]}>{part2.polybagSpec}</Text>

          <Text style={[docStyles.labelMockCaption, { marginBottom: 2 }]}>Folding Instructions</Text>
          {foldingSteps ? (
            foldingSteps.map((step, i) => (
              <View key={i} style={docStyles.numberedStep}>
                <Text style={docStyles.numberedStepIndex}>{i + 1}.</Text>
                <Text style={docStyles.numberedStepText}>{step}</Text>
              </View>
            ))
          ) : (
            <Text style={[docStyles.notesText, { marginBottom: 6 }]}>{part2.foldingInstructions}</Text>
          )}

          <Text style={docStyles.sectionTitle}>Barcode</Text>
          <View style={docStyles.barcodeBox}>
            <Code128Barcode value={projectNumber} />
          </View>
          <Text style={docStyles.notesText}>{part2.barcodePlacement}</Text>
        </>
      )}

      <Page size="A4" style={docStyles.page}>
        <View style={docStyles.letterheadRow}>
          <View style={docStyles.companyRow}>
            <View style={docStyles.companyBadge}>
              <Text style={docStyles.companyBadgeText}>{(companyName.trim()[0] ?? "?").toUpperCase()}</Text>
            </View>
            <Text style={docStyles.companyName}>{companyName}</Text>
          </View>
          <View style={docStyles.docTitleBlock}>
            <Text style={docStyles.docTitle}>GARMENT TECH PACK — NOTES FOR DESIGNER</Text>
            <Text style={docStyles.docMetaLine} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </View>
        <View style={docStyles.headerRule} />
        <Text style={docStyles.brandBlock}>
          {projectNumber} — {projectName} · Generated {generatedAt}
        </Text>
        <Text style={docStyles.sectionTitle}>Notes for Designer</Text>
        <Text style={docStyles.notesText}>{designerNotes}</Text>
        <Text style={docStyles.sectionTitle}>Suggested Additional Views</Text>
        <Text style={docStyles.notesText}>{suggestedAdditionalViews}</Text>
        <View style={docStyles.footer} fixed>
          <Text style={docStyles.footerItalic}>ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderTechPackDocumentPdf(props: TechPackDocumentProps): Promise<Buffer> {
  return renderToBuffer(<TechPackFullDocument {...props} />);
}

// ---------------------------------------------------------------------------
// v2 (2026-09-22) — AI Designer's own Tech Pack, rebuilt on the new "GARMENT
// TECH PACK STRUCTURED DATA GENERATOR" prompt (see tech-pack/schema.ts's own
// v4 doc comment): 12 pages (was 7) — Fabric & Materials, Production
// Instructions, QC Checkpoints, Assumptions & Missing Data, Additional
// Reference Images Required, and Hangtag & Barcode (split out of Labels &
// Packaging) are all new — and every fact-level value now carries its own
// `{value, status}` confidence tag instead of an inline "[NOT VISIBLE]"
// text marker.
//
// A NEW, separate renderer rather than an edit to TechPackFullDocument
// above: Replicate Design (a genuinely separate, deliberately isolated
// module — see its own tech-pack/schema.ts) calls THAT renderer with its
// own, independently-forked, still-v1-shaped GarmentAnalysis-equivalent;
// changing the shared interface out from under it would break that module
// for no reason. This new renderer reuses every still-generic helper above
// (PageChrome, DataTable, KeyValueList, SwatchChip, ArtworkImage,
// Code128Barcode, docStyles) — only the document layout/shape is new.
// ---------------------------------------------------------------------------

export interface TechPackStatusValueForPdf {
  value: string;
  status: string;
}

export interface TechPackAnalysisForPdfV2 {
  part1: {
    identification: Record<string, TechPackStatusValueForPdf>;
    construction: Record<string, TechPackStatusValueForPdf>;
    closure: { closureType: TechPackStatusValueForPdf; closureDetails: TechPackStatusValueForPdf };
    seamCallouts: { calloutNumber: number; location: string; technicalSpecification: string; status: string; xPercent?: number; yPercent?: number }[];
    visibleColors: { colorName: string; pantoneEstimate: TechPackStatusValueForPdf; hexEstimate: TechPackStatusValueForPdf; garmentPanel: string }[];
    suggestedColorways: {
      colorwayCode: string;
      colorwayName: string;
      mainColor: string;
      contrastColor: string;
      trimColor: string;
      artworkColor: string;
      notes: string;
      mainColorHex?: string;
      contrastColorHex?: string;
      trimColorHex?: string;
      artworkColorHex?: string;
    }[];
    artworkItems: {
      artworkType: string;
      placement: string;
      scale: string;
      dimensions: TechPackStatusValueForPdf;
      alignment: string;
      printMethod: string;
      distanceFromHps: TechPackStatusValueForPdf;
      distanceFromCf: TechPackStatusValueForPdf;
    }[];
    artworkSummary: string;
    patternPrintType: string;
    patternPrintNotes: string;
  };
  part2: {
    fabricMaterials: {
      materialRole: string;
      fabricType: string;
      composition: TechPackStatusValueForPdf;
      gsm: TechPackStatusValueForPdf;
      width: TechPackStatusValueForPdf;
      finish: string;
      consumption: TechPackStatusValueForPdf;
      supplierNotes: string;
      garmentPiece?: string;
    }[];
    bomItems: { materialType: string; composition: TechPackStatusValueForPdf; gsm: TechPackStatusValueForPdf; color: string; consumption: TechPackStatusValueForPdf; notes: string; garmentPiece?: string }[];
    measurementPoints: { pointName: string; howToMeasure: string; toleranceCm: string; status: string; values: Record<string, string>; garmentPiece?: string }[];
    gradeRulesNotes: string;
  };
  part3: {
    productionInstructions: { stepNumber: number; instruction: string }[];
    qcCheckpoints: { checkpointArea: string; whatToCheck: string; acceptanceCriteria: string; toolsOrMethod: string }[];
    mainLabelSpec: TechPackStatusValueForPdf;
    sizeLabelSpec: TechPackStatusValueForPdf;
    careLabelSpec: TechPackStatusValueForPdf;
    polybagSpec: TechPackStatusValueForPdf;
    foldingInstructions: string;
    cartonPackingSpec: TechPackStatusValueForPdf;
    hangtagSpec: TechPackStatusValueForPdf;
    barcodeType: TechPackStatusValueForPdf;
    barcodeContent: TechPackStatusValueForPdf;
    barcodePlacement: TechPackStatusValueForPdf;
  };
  part4: {
    assumptionsAndMissingData: { item: string; assumptionMade: string; status: string }[];
    additionalReferenceImagesRequired: { viewNeeded: string; reason: string }[];
    designerNotes: string;
  };
}

/** Multi-piece Set support (2026-09-22) — the real AiDesignerProjectPiece rows, when the project is a SET. Pure real data, not AI-generated. */
export interface TechPackSetPieceForPdf {
  pieceLabel: string;
  productCategory: string | null;
}

/** Revision History (2026-09-22) — walked from the real AiDesignerTechPack approve/revision chain (revisionNumber/createdAt/createdBy/approvedAt/approvedBy), oldest first. Pure real data, zero AI. */
export interface TechPackRevisionHistoryEntryForPdf {
  revisionNumber: number;
  createdAt: string;
  createdByName: string;
  approvalStatus: "DRAFT" | "APPROVED";
  approvedAt: string | null;
  approvedByName: string | null;
}

export interface TechPackDocumentPropsV2 {
  projectNumber: string;
  projectName: string;
  generatedAt: string;
  analysis: TechPackAnalysisForPdfV2;
  images: TechPackDocumentPageImage[];
  companyName?: string;
  realStyleInfo?: TechPackRealStyleInfo;
  page2ImageDimensions?: { width: number; height: number };
  setPieces?: TechPackSetPieceForPdf[];
  revisionHistory?: TechPackRevisionHistoryEntryForPdf[];
}

/** Formats a `{value, status}` pair as one line of PDF text — a plain, low-risk bracket-tag suffix (no bespoke colored-badge PDF component needed) that still gives every fact its own visibly separate confidence tag, exactly as the new prompt's own ERP/database output convention calls for. */
function fmtSV(sv: TechPackStatusValueForPdf | undefined): string {
  if (!sv) return "—";
  return `${sv.value}  [${sv.status}]`;
}

function resolveStyleInfoV2(analysis: TechPackAnalysisForPdfV2, realStyleInfo: TechPackRealStyleInfo | undefined): TechPackRealStyleInfo {
  if (realStyleInfo) return realStyleInfo;
  const id = analysis.part1.identification;
  return {
    brandName: id.brandName?.value ?? "—",
    styleName: id.styleName?.value ?? "—",
    styleNumber: id.styleNumber?.value ?? "—",
    category: id.garmentCategory?.value ?? "—",
    targetCustomer: id.genderCategory?.value ?? "—",
    designerName: id.designer?.value ?? "—",
    dateCreated: id.dateCreated?.value ?? "—",
  };
}

function TechPackFullDocumentV2({
  projectNumber,
  projectName,
  generatedAt,
  analysis,
  images,
  companyName: companyNameProp,
  realStyleInfo: realStyleInfoProp,
  page2ImageDimensions,
  setPieces,
  revisionHistory,
}: TechPackDocumentPropsV2) {
  const { part1, part2, part3, part4 } = analysis;
  const companyName = companyNameProp ?? DEFAULT_COMPANY_NAME;
  const realStyleInfo = resolveStyleInfoV2(analysis, realStyleInfoProp);
  const imageFor = (pageNumber: number) => images.find((i) => i.pageNumber === pageNumber);
  const chrome = (pageNumber: number, title: string, children: ReactNode) => (
    <PageChrome
      key={pageNumber}
      title={title}
      projectNumber={projectNumber}
      projectName={projectName}
      generatedAt={generatedAt}
      companyName={companyName}
      realStyleInfo={realStyleInfo}
    >
      {children}
    </PageChrome>
  );

  const pinnedCallouts = part1.seamCallouts.filter(
    (c) => typeof c.xPercent === "number" && typeof c.yPercent === "number" && c.xPercent! >= 0 && c.xPercent! <= 100 && c.yPercent! >= 0 && c.yPercent! <= 100
  );
  const calloutImageRect = page2ImageDimensions
    ? computeContainFitRect(page2ImageDimensions.width, page2ImageDimensions.height, CALLOUT_BOX_WIDTH_PT, CALLOUT_BOX_HEIGHT_PT)
    : { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 };
  const gradeRules = computeGradeRules(part2.measurementPoints);
  const foldingSteps = tryParseNumberedSteps(part3.foldingInstructions);

  // Multi-piece Set support (2026-09-22) — when any row of a piece-taggable
  // table actually carries a garmentPiece (only ever true for a SET-mode
  // project — see AiDesignerProjectMode), sort that table's rows so same-
  // piece rows sit together and add a leading "Piece" column, approximating
  // the reference document's own separate-table-per-piece layout within this
  // renderer's existing single-flat-table shape. A SINGLE-garment project's
  // rows never carry garmentPiece at all, so every one of these is a no-op
  // there — byte-for-byte the same table as before.
  const hasFabricPieces = part2.fabricMaterials.some((f) => f.garmentPiece);
  const hasBomPieces = part2.bomItems.some((b) => b.garmentPiece);
  const hasMeasurementPieces = part2.measurementPoints.some((p) => p.garmentPiece);
  const byPiece = <T extends { garmentPiece?: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (a.garmentPiece ?? "").localeCompare(b.garmentPiece ?? ""));
  const sortedFabricMaterials = hasFabricPieces ? byPiece(part2.fabricMaterials) : part2.fabricMaterials;
  const sortedBomItems = hasBomPieces ? byPiece(part2.bomItems) : part2.bomItems;
  const sortedMeasurementPoints = hasMeasurementPieces ? byPiece(part2.measurementPoints) : part2.measurementPoints;

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
              ["Brand", realStyleInfo.brandName],
              ["Style Name", realStyleInfo.styleName],
              ["Style Number", realStyleInfo.styleNumber],
              ["Category", `${realStyleInfo.category} — ${fmtSV(part1.identification.subCategory)}`],
              ["Fit Type", fmtSV(part1.identification.fitType)],
              ["Gender / Category", realStyleInfo.targetCustomer],
              ["Target Season", fmtSV(part1.identification.targetSeason)],
              ["Base Sample Size", fmtSV(part1.identification.baseSampleSize)],
              ["Designer", realStyleInfo.designerName],
              ["Date Created", realStyleInfo.dateCreated],
            ]}
          />
          <Text style={docStyles.sectionTitle}>Key Specs</Text>
          <KeyValueList
            items={[
              ["Silhouette", fmtSV(part1.construction.silhouette)],
              ["Body Length", fmtSV(part1.construction.bodyLength)],
              ["Closure", fmtSV(part1.closure.closureType)],
            ]}
          />
          {setPieces && setPieces.length > 0 && (
            <>
              <Text style={docStyles.sectionTitle}>Set Pieces ({setPieces.length}-piece set)</Text>
              <DataTable
                headers={["#", "Piece", "Category"]}
                rows={setPieces.map((p, i) => [String(i + 1), p.pieceLabel, p.productCategory || "—"])}
              />
            </>
          )}
          {revisionHistory && revisionHistory.length > 0 && (
            <>
              <Text style={docStyles.sectionTitle}>Revision History</Text>
              <DataTable
                headers={["Rev", "Date", "Prepared By", "Status", "Approved By", "Approved Date"]}
                rows={revisionHistory.map((r) => [
                  String(r.revisionNumber).padStart(2, "0"),
                  r.createdAt,
                  r.createdByName,
                  r.approvalStatus,
                  r.approvedByName || "—",
                  r.approvedAt || "—",
                ])}
                zebra
              />
            </>
          )}
        </>
      )}

      {chrome(
        2,
        "Construction & Detail Callouts",
        <>
          <Text style={docStyles.imageCaption}>Reference: Selected Design Photo — used for construction callouts</Text>
          <View style={docStyles.calloutImageWrapper}>
            <ArtworkImage image={imageFor(2)} />
            {pinnedCallouts.map((c) => {
              const { left, top } = mapCalloutPositionToBoxPercent({ xPercent: c.xPercent!, yPercent: c.yPercent! }, calloutImageRect);
              return (
                <View key={c.calloutNumber} style={[docStyles.pin, { left: `${left}%`, top: `${top}%` }]}>
                  <Text style={docStyles.pinText}>{c.calloutNumber}</Text>
                </View>
              );
            })}
          </View>
          <Text style={docStyles.sectionTitle}>Construction Legend</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.pinBadgeCell}>#</Text>
              <Text style={docStyles.th}>Location</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Technical Specification</Text>
              <Text style={docStyles.th}>Status</Text>
            </View>
            {part1.seamCallouts.map((c, i) => (
              <View key={c.calloutNumber} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <View style={docStyles.pinBadgeCell}>
                  <View style={docStyles.pinBadge}>
                    <Text style={docStyles.pinBadgeText}>{c.calloutNumber}</Text>
                  </View>
                </View>
                <Text style={docStyles.td}>{c.location}</Text>
                <Text style={[docStyles.td, { flex: 2 }]}>{c.technicalSpecification}</Text>
                <Text style={docStyles.td}>{c.status}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {chrome(
        3,
        "Fabric & Materials",
        <>
          <Text style={docStyles.sectionTitle}>Fabric &amp; Materials</Text>
          <DataTable
            headers={[...(hasFabricPieces ? ["Piece"] : []), "Role", "Fabric Type", "Composition", "GSM", "Width", "Finish", "Consumption", "Supplier Notes"]}
            rows={sortedFabricMaterials.map((f) => [
              ...(hasFabricPieces ? [f.garmentPiece || "Common / Shared"] : []),
              f.materialRole,
              f.fabricType,
              fmtSV(f.composition),
              fmtSV(f.gsm),
              fmtSV(f.width),
              f.finish,
              fmtSV(f.consumption),
              f.supplierNotes,
            ])}
            zebra
          />
        </>
      )}

      {chrome(
        4,
        "Bill of Materials / BOM",
        <>
          <Text style={docStyles.sectionTitle}>Bill of Materials (Trims &amp; Notions)</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.swatchCol}>Swatch</Text>
              {hasBomPieces && <Text style={docStyles.th}>Piece</Text>}
              <Text style={docStyles.th}>Material Type</Text>
              <Text style={docStyles.th}>Composition</Text>
              <Text style={docStyles.th}>GSM</Text>
              <Text style={docStyles.th}>Color</Text>
              <Text style={docStyles.th}>Consumption</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Notes</Text>
            </View>
            {sortedBomItems.map((b, i) => (
              <View key={i} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <View style={docStyles.swatchCol}>
                  <SwatchChip hex={findColorHexForBomRow(b.color, part1.visibleColors.map((c) => ({ colorName: c.colorName, hexEstimate: c.hexEstimate.value })))} />
                </View>
                {hasBomPieces && <Text style={docStyles.td}>{b.garmentPiece || "Common / Shared"}</Text>}
                <Text style={docStyles.td}>{b.materialType}</Text>
                <Text style={docStyles.td}>{fmtSV(b.composition)}</Text>
                <Text style={docStyles.td}>{fmtSV(b.gsm)}</Text>
                <Text style={docStyles.td}>{b.color}</Text>
                <Text style={docStyles.td}>{fmtSV(b.consumption)}</Text>
                <Text style={[docStyles.td, { flex: 2 }]}>{b.notes}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {chrome(
        5,
        "Colorways & Artwork Placement",
        <>
          <ArtworkImage image={imageFor(5)} />
          <Text style={docStyles.sectionTitle}>Visible Colors</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.swatchCol}>Swatch</Text>
              <Text style={docStyles.th}>Color</Text>
              <Text style={docStyles.th}>Pantone (est.)</Text>
              <Text style={docStyles.th}>HEX (est.)</Text>
              <Text style={docStyles.th}>Panel</Text>
            </View>
            {part1.visibleColors.map((c, i) => (
              <View key={i} style={i === part1.visibleColors.length - 1 ? docStyles.tableRowLast : docStyles.tableRow}>
                <View style={docStyles.swatchCol}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.hexEstimate.value, colorName: c.colorName })} />
                </View>
                <Text style={docStyles.td}>{c.colorName}</Text>
                <Text style={docStyles.td}>{fmtSV(c.pantoneEstimate)}</Text>
                <Text style={docStyles.td}>{fmtSV(c.hexEstimate)}</Text>
                <Text style={docStyles.td}>{c.garmentPanel}</Text>
              </View>
            ))}
          </View>
          <Text style={docStyles.sectionTitle}>Suggested Commercial Colorways</Text>
          <View style={docStyles.table}>
            <View style={docStyles.tableHeaderRow}>
              <Text style={docStyles.th}>Code</Text>
              <Text style={docStyles.th}>Name</Text>
              <Text style={docStyles.th}>Main</Text>
              <Text style={docStyles.th}>Contrast</Text>
              <Text style={docStyles.th}>Trim</Text>
              <Text style={docStyles.th}>Artwork</Text>
              <Text style={[docStyles.th, { flex: 2 }]}>Notes</Text>
            </View>
            {part1.suggestedColorways.map((c, i) => (
              <View key={i} style={i % 2 === 1 ? [docStyles.tableRow, docStyles.tableRowZebra] : docStyles.tableRow}>
                <Text style={docStyles.td}>{c.colorwayCode}</Text>
                <Text style={docStyles.td}>{c.colorwayName}</Text>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.mainColorHex, colorName: c.mainColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.mainColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.contrastColorHex, colorName: c.contrastColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.contrastColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.trimColorHex, colorName: c.trimColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.trimColor}</Text>
                </View>
                <View style={[docStyles.td, { flexDirection: "row", alignItems: "center" }]}>
                  <SwatchChip hex={resolveColorHex({ hexEstimate: c.artworkColorHex, colorName: c.artworkColor })} />
                  <Text style={{ marginLeft: 2 }}>{c.artworkColor}</Text>
                </View>
                <Text style={[docStyles.td, { flex: 2 }]}>{c.notes}</Text>
              </View>
            ))}
          </View>
          <Text style={docStyles.sectionTitle}>Artwork Reference</Text>
          <DataTable
            headers={["Type", "Placement", "Scale", "Dimensions", "Alignment", "Print Method", "From HPS", "From CF"]}
            rows={part1.artworkItems.map((a) => [a.artworkType, a.placement, a.scale, fmtSV(a.dimensions), a.alignment, a.printMethod, fmtSV(a.distanceFromHps), fmtSV(a.distanceFromCf)])}
          />
        </>
      )}

      {chrome(
        6,
        "Measurements & Spec Table",
        <>
          <ArtworkImage image={imageFor(6)} />
          <Text style={docStyles.sectionTitle}>Point-of-Measure Spec Table</Text>
          <DataTable
            headers={[...(hasMeasurementPieces ? ["Piece"] : []), "Point", "How to Measure", "Tolerance", "Status", ...Object.keys(part2.measurementPoints[0]?.values ?? {})]}
            rows={sortedMeasurementPoints.map((p) => [
              ...(hasMeasurementPieces ? [p.garmentPiece || "Common / Shared"] : []),
              p.pointName,
              p.howToMeasure,
              p.toleranceCm,
              p.status,
              ...Object.values(p.values),
            ])}
            zebra
          />
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        7,
        "Size Grading",
        <>
          <Text style={docStyles.sectionTitle}>Grade Rules (derived from the Point-of-Measure chart)</Text>
          <DataTable headers={["Point", "Grade Rule (per size step)"]} rows={gradeRules.map((r) => [r.pointName, r.grade])} zebra />
          <Text style={docStyles.notesText}>
            Grade rule = increment applied per adjacent size step (XS to S to M to L to XL to XXL). &quot;Non-linear&quot; means the increment is not
            consistent across every step — refer to the full Measurements &amp; Spec Table on the previous page.
          </Text>
          <Text style={docStyles.sectionTitle}>Size Explanation / Fit Notes</Text>
          <Text style={docStyles.notesText}>{part2.gradeRulesNotes}</Text>
        </>
      )}

      {chrome(
        8,
        "Production Instructions",
        <>
          <Text style={docStyles.sectionTitle}>Production Instructions</Text>
          {part3.productionInstructions
            .slice()
            .sort((a, b) => a.stepNumber - b.stepNumber)
            .map((s) => (
              <View key={s.stepNumber} style={docStyles.numberedStep}>
                <Text style={docStyles.numberedStepIndex}>{s.stepNumber}.</Text>
                <Text style={docStyles.numberedStepText}>{s.instruction}</Text>
              </View>
            ))}
        </>
      )}

      {chrome(
        9,
        "Quality Control Checkpoints",
        <>
          <Text style={docStyles.sectionTitle}>QC Checkpoints</Text>
          <DataTable
            headers={["Checkpoint Area", "What to Check", "Acceptance Criteria", "Tool / Method"]}
            rows={part3.qcCheckpoints.map((q) => [q.checkpointArea, q.whatToCheck, q.acceptanceCriteria, q.toolsOrMethod])}
            zebra
          />
        </>
      )}

      {chrome(
        10,
        "Labels & Packaging",
        <>
          <Text style={docStyles.sectionTitle}>Label Specs</Text>
          <View style={docStyles.labelMockRow}>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Main Label</Text>
              <Text style={docStyles.labelMockText}>{fmtSV(part3.mainLabelSpec)}</Text>
            </View>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Size Label</Text>
              <Text style={docStyles.labelMockText}>{fmtSV(part3.sizeLabelSpec)}</Text>
            </View>
            <View style={docStyles.labelMockBox}>
              <Text style={docStyles.labelMockCaption}>Care Label</Text>
              <Text style={docStyles.labelMockText}>{fmtSV(part3.careLabelSpec)}</Text>
            </View>
          </View>

          <Text style={docStyles.sectionTitle}>Packaging</Text>
          <View style={docStyles.cartonBox}>
            <Text style={docStyles.labelMockCaption}>Carton</Text>
            <Text style={docStyles.labelMockText}>{fmtSV(part3.cartonPackingSpec)}</Text>
          </View>
          <Text style={[docStyles.labelMockCaption, { marginBottom: 2 }]}>Polybag</Text>
          <Text style={[docStyles.notesText, { marginBottom: 6 }]}>{fmtSV(part3.polybagSpec)}</Text>

          <Text style={[docStyles.labelMockCaption, { marginBottom: 2 }]}>Folding Instructions</Text>
          {foldingSteps ? (
            foldingSteps.map((step, i) => (
              <View key={i} style={docStyles.numberedStep}>
                <Text style={docStyles.numberedStepIndex}>{i + 1}.</Text>
                <Text style={docStyles.numberedStepText}>{step}</Text>
              </View>
            ))
          ) : (
            <Text style={[docStyles.notesText, { marginBottom: 6 }]}>{part3.foldingInstructions}</Text>
          )}
        </>
      )}

      {chrome(
        11,
        "Hangtag & Barcode",
        <>
          <Text style={docStyles.sectionTitle}>Hangtag</Text>
          <View style={docStyles.cartonBox}>
            <Text style={docStyles.labelMockText}>{fmtSV(part3.hangtagSpec)}</Text>
          </View>

          <Text style={docStyles.sectionTitle}>Barcode</Text>
          <KeyValueList
            items={[
              ["Type", fmtSV(part3.barcodeType)],
              ["Content", fmtSV(part3.barcodeContent)],
              ["Placement", fmtSV(part3.barcodePlacement)],
            ]}
          />
          <View style={[docStyles.barcodeBox, { marginTop: 6 }]}>
            <Code128Barcode value={projectNumber} />
          </View>
        </>
      )}

      {chrome(
        12,
        "Assumptions, Missing Data & Reference Images Needed",
        <>
          <Text style={docStyles.sectionTitle}>Assumptions &amp; Missing Data</Text>
          {part4.assumptionsAndMissingData.length > 0 ? (
            <DataTable
              headers={["Item", "Assumption / Gap", "Status"]}
              rows={part4.assumptionsAndMissingData.map((a) => [a.item, a.assumptionMade, a.status])}
              zebra
            />
          ) : (
            <Text style={docStyles.notesText}>None flagged — every fact in this tech pack was directly confirmed.</Text>
          )}

          <Text style={docStyles.sectionTitle}>Additional Reference Images Required</Text>
          {part4.additionalReferenceImagesRequired.length > 0 ? (
            <DataTable
              headers={["View Needed", "Reason"]}
              rows={part4.additionalReferenceImagesRequired.map((r) => [r.viewNeeded, r.reason])}
            />
          ) : (
            <Text style={docStyles.notesText}>None — the supplied reference image is sufficient.</Text>
          )}

          <Text style={docStyles.sectionTitle}>Designer Notes</Text>
          <Text style={docStyles.notesText}>{part4.designerNotes}</Text>
        </>
      )}
    </Document>
  );
}

export async function renderTechPackDocumentPdfV2(props: TechPackDocumentPropsV2): Promise<Buffer> {
  return renderToBuffer(<TechPackFullDocumentV2 {...props} />);
}
