import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { gradedValue, type MasterAnalysis, type MasterField } from "@/core/ai-designer/tech-pack-master/schema";

/**
 * Master-prompt (hybrid) Tech Pack PDF — 7 portrait pages in order:
 *   AI pages (1, 2, 4, 7): the AI-generated page image, full page.
 *   HYBRID pages (3, 5, 6 — BOM, spec table, grading): the AI-generated
 *     illustration (a materials board / measurement diagram / grade
 *     silhouettes — never the actual numbers, see page-prompts.ts) composited
 *     at the top of the page, with the real table drawn here directly from
 *     the analysis underneath it, so every number is exact. Same
 *     header/footer as the AI pages. A missing illustration (still
 *     generating, failed, or an older tech pack generated before this
 *     illustration existed) is simply omitted — the real table alone still
 *     renders correctly.
 * A missing AI page image gets a clear placeholder, so the PDF always has 7 pages.
 */
export interface TechPackPdfPage {
  pageNumber: number;
  pageTitle: string;
  mode: "AI" | "HYBRID";
  image: { buffer: Buffer; mimeType: string } | null;
}

const PAGE_SIZE: [number, number] = [595, 892.5]; // 2:3, matching the 1024×1536 AI page images
const FOOTER = "ALL MEASUREMENTS IN CENTIMETERS (CM) UNLESS OTHERWISE SPECIFIED. TOLERANCES APPLY.";

const s = StyleSheet.create({
  page: { padding: 0, backgroundColor: "#ffffff" },
  image: { width: "100%", height: "100%", objectFit: "contain" },
  tsPage: { paddingTop: 30, paddingBottom: 44, paddingHorizontal: 32, backgroundColor: "#ffffff", fontFamily: "Helvetica", fontSize: 8, color: "#18181b" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  headPage: { fontSize: 10 },
  rule: { borderBottomWidth: 0.8, borderBottomColor: "#18181b", marginTop: 6, marginBottom: 10 },
  infoRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  logoBox: { width: 110, height: 34, borderWidth: 0.6, borderColor: "#a1a1aa", alignItems: "center", justifyContent: "center", marginRight: 14 },
  logoText: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  infoText: { fontSize: 8.5, lineHeight: 1.5, color: "#3f3f46" },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 5 },
  table: { borderWidth: 0.5, borderColor: "#a1a1aa" },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d4d4d8" },
  th: { backgroundColor: "#f4f4f5", fontFamily: "Helvetica-Bold", fontSize: 7.5, padding: 3.5, borderRightWidth: 0.5, borderRightColor: "#d4d4d8" },
  td: { fontSize: 7.5, padding: 3.5, borderRightWidth: 0.5, borderRightColor: "#e4e4e7" },
  base: { backgroundColor: "#f5f3ff", fontFamily: "Helvetica-Bold" },
  noteBox: { borderWidth: 0.5, borderColor: "#a1a1aa", padding: 6, marginTop: 10 },
  noteTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 3 },
  footer: { position: "absolute", bottom: 20, left: 32, right: 32, fontSize: 7, fontFamily: "Helvetica-Oblique", color: "#52525b", borderTopWidth: 0.5, borderTopColor: "#d4d4d8", paddingTop: 5 },
  illustrationBox: { height: 260, marginBottom: 10, alignItems: "center", justifyContent: "center", borderWidth: 0.5, borderColor: "#e4e4e7" },
  illustrationImage: { width: "100%", height: "100%", objectFit: "contain" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
});

const MISSING = /^(tbc|tbd|n\/?a|none|unknown|not set|not visible|not specified|-|—)$/i;
function val(fields: MasterField[], label: string): string {
  const f = fields.find((x) => x.label.toLowerCase().includes(label));
  const v = f?.value?.trim() ?? "";
  return !v || MISSING.test(v) || f?.status === "NOT_VISIBLE" ? "TBC" : v;
}

function dataUri(img: { buffer: Buffer; mimeType: string }): string {
  return `data:${img.mimeType};base64,${img.buffer.toString("base64")}`;
}

interface Col {
  label: string;
  flex: number;
  align?: "left" | "center";
}

function Table({ cols, rows, highlightCol }: { cols: Col[]; rows: string[][]; highlightCol?: number }) {
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>
        {cols.map((c, i) => (
          <Text key={i} style={[s.th, { flex: c.flex, textAlign: c.align ?? "left" }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {r.map((cell, ci) => (
            <Text key={ci} style={[s.td, { flex: cols[ci].flex, textAlign: cols[ci].align ?? "left" }, ci === highlightCol ? s.base : {}]}>
              {cell || "—"}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Illustration({ image }: { image: { buffer: Buffer; mimeType: string } | null }) {
  if (!image) return null;
  return (
    <View style={s.illustrationBox}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
      <Image src={dataUri(image)} style={s.illustrationImage} />
    </View>
  );
}

function TypesetFrame({ a, pageNumber, title, children }: { a: MasterAnalysis; pageNumber: number; title: string; children: React.ReactNode }) {
  const brand = val(a.identification, "brand");
  return (
    <Page size={PAGE_SIZE} style={s.tsPage}>
      <View style={s.headRow}>
        <Text style={s.headTitle}>
          PAGE {pageNumber} — {title}
        </Text>
        <Text style={s.headPage}>{pageNumber} of 7</Text>
      </View>
      <View style={s.rule} />
      <View style={s.infoRow}>
        <View style={s.logoBox}>
          <Text style={s.logoText}>{brand === "TBC" ? "" : brand}</Text>
        </View>
        <Text style={s.infoText}>
          Style No. {val(a.identification, "style number")}
          {"\n"}Style Name {val(a.identification, "style name")}
          {"\n"}Season {val(a.identification, "season")} · Base Size {a.baseSize}
        </Text>
      </View>
      {children}
      <Text style={s.footer} fixed>
        {FOOTER}
      </Text>
    </Page>
  );
}

function BomPage({ a, illustration }: { a: MasterAnalysis; illustration: { buffer: Buffer; mimeType: string } | null }) {
  return (
    <TypesetFrame a={a} pageNumber={3} title="BILL OF MATERIALS / BOM">
      <Illustration image={illustration} />
      <Table
        cols={[
          { label: "#", flex: 0.4, align: "center" },
          { label: "Item", flex: 1.4 },
          { label: "Description", flex: 1.8 },
          { label: "Composition", flex: 1.5 },
          { label: "GSM", flex: 0.8 },
          { label: "Color", flex: 0.9 },
          { label: "Consumption", flex: 1.1 },
          { label: "Supplier", flex: 1.1 },
          { label: "Notes", flex: 1.6 },
        ]}
        rows={a.bom.map((b, i) => [String(i + 1), b.item, b.description, b.composition, b.gsm, b.color, b.consumption, b.supplier, b.notes])}
      />
      <View style={s.noteBox} wrap={false}>
        <Text style={s.noteTitle}>MATERIAL NOTES</Text>
        <Text>All materials to meet buyer quality standards. Rows marked TBC / TBD must be confirmed with the supplier before bulk.</Text>
      </View>
      <View style={s.noteBox} wrap={false}>
        <Text style={s.noteTitle}>QUALITY NOTES</Text>
        <Text>Shade band approval before bulk. Colour fastness and shrinkage tests required.</Text>
      </View>
    </TypesetFrame>
  );
}

function SpecPage({ a, illustration }: { a: MasterAnalysis; illustration: { buffer: Buffer; mimeType: string } | null }) {
  return (
    <TypesetFrame a={a} pageNumber={5} title="MEASUREMENTS & SPEC TABLE">
      <Illustration image={illustration} />
      <Text style={s.sectionTitle}>SPEC TABLE — BASE SIZE {a.baseSize}</Text>
      <Table
        cols={[
          { label: "Code", flex: 0.5, align: "center" },
          { label: "Point of Measure", flex: 2 },
          { label: `${a.baseSize} (cm)`, flex: 0.8, align: "center" },
          { label: "Tolerance", flex: 0.8, align: "center" },
        ]}
        rows={a.measurements.map((m) => [m.code, m.pom, String(gradedValue(a, m, a.baseSize)), m.tolerance])}
      />
      <Text style={s.sectionTitle}>HOW TO MEASURE</Text>
      <Table
        cols={[
          { label: "Code", flex: 0.5, align: "center" },
          { label: "Point of Measure", flex: 1.4 },
          { label: "Instruction", flex: 4 },
        ]}
        rows={a.measurements.map((m) => [m.code, m.pom, m.howToMeasure])}
      />
      <View style={s.noteBox} wrap={false}>
        <Text style={s.noteTitle}>MEASUREMENT NOTES</Text>
        <Text>Measure the garment flat and unstretched. All measurements in centimetres.</Text>
      </View>
    </TypesetFrame>
  );
}

function GradingPage({ a, illustration }: { a: MasterAnalysis; illustration: { buffer: Buffer; mimeType: string } | null }) {
  const baseIdx = a.sizes.indexOf(a.baseSize);
  return (
    <TypesetFrame a={a} pageNumber={6} title="SIZE GRADING">
      <Illustration image={illustration} />
      <Text style={s.sectionTitle}>GRADE TABLE (cm)</Text>
      <Table
        cols={[
          { label: "Code", flex: 0.5, align: "center" },
          { label: "Point of Measure", flex: 2 },
          ...a.sizes.map((size) => ({ label: size === a.baseSize ? `${size} (base)` : size, flex: 0.7, align: "center" as const })),
          { label: "Grade", flex: 0.7, align: "center" as const },
        ]}
        rows={a.measurements.map((m) => [m.code, m.pom, ...a.sizes.map((size) => String(gradedValue(a, m, size))), `± ${m.gradeRule}`])}
        highlightCol={baseIdx >= 0 ? baseIdx + 2 : undefined}
      />
      <View style={s.noteBox} wrap={false}>
        <Text style={s.noteTitle}>SIZE EXPLANATION</Text>
        <Text>
          Base sample size {a.baseSize}. Each size step applies the grade shown per point of measure (smaller sizes subtract, larger sizes add); values are
          rounded to 0.5 cm.
        </Text>
      </View>
      <View style={s.noteBox} wrap={false}>
        <Text style={s.noteTitle}>FIT NOTES</Text>
        <Text>Fit: {val(a.identification, "fit")}. Maintain proportions across all sizes; approve a fit sample in the base size before grading.</Text>
      </View>
    </TypesetFrame>
  );
}

export async function renderTechPackImagesPdf(params: { title: string; analysis: MasterAnalysis; pages: TechPackPdfPage[] }): Promise<Buffer> {
  const { analysis: a } = params;
  const doc = (
    <Document title={params.title}>
      {params.pages.map((p) => {
        if (p.mode === "HYBRID") {
          if (p.pageNumber === 3) return <BomPage key={p.pageNumber} a={a} illustration={p.image} />;
          if (p.pageNumber === 5) return <SpecPage key={p.pageNumber} a={a} illustration={p.image} />;
          if (p.pageNumber === 6) return <GradingPage key={p.pageNumber} a={a} illustration={p.image} />;
        }
        return (
          <Page key={p.pageNumber} size={PAGE_SIZE} style={s.page}>
            {p.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image, not an HTML img
              <Image src={dataUri(p.image)} style={s.image} />
            ) : (
              <View style={s.placeholder}>
                <Text style={{ fontSize: 16, marginBottom: 8 }}>
                  PAGE {p.pageNumber} — {p.pageTitle}
                </Text>
                <Text style={{ fontSize: 10, color: "#71717a" }}>This page image has not been generated yet.</Text>
              </View>
            )}
          </Page>
        );
      })}
    </Document>
  );
  return renderToBuffer(doc);
}
