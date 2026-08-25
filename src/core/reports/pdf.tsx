import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ReportColumn, ReportDescriptor } from "./report-types";
import { EXPORT_ROW_CAP_PDF } from "./constants";

const styles = StyleSheet.create({
  page: { paddingTop: 90, paddingBottom: 50, paddingHorizontal: 24, fontSize: 8 },
  header: { position: "absolute", top: 20, left: 24, right: 24 },
  companyName: { fontSize: 12, fontWeight: 700 },
  title: { fontSize: 11, fontWeight: 700, marginTop: 2 },
  subtitle: { fontSize: 8, color: "#555", marginTop: 2 },
  filters: { fontSize: 7, color: "#666", marginTop: 3 },
  meta: { fontSize: 7, color: "#888", marginTop: 2, marginBottom: 4 },
  headerRule: { borderBottomWidth: 1, borderBottomColor: "#333", marginTop: 6 },
  table: { display: "flex", width: "auto" },
  row: { flexDirection: "row" },
  headerRowCell: { fontWeight: 700, backgroundColor: "#eee", padding: 3, fontSize: 7.5 },
  cell: { padding: 3, fontSize: 7.5, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  totalsCell: { padding: 3, fontSize: 7.5, fontWeight: 700, backgroundColor: "#f5f5f5" },
  footer: {
    position: "absolute",
    bottom: 15,
    left: 24,
    right: 24,
    fontSize: 7,
    color: "#888",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cap: { fontSize: 7, color: "#a00", marginTop: 4 },
});

function formatCellValue(value: unknown, type: ReportColumn["type"]): string {
  if (value === null || value === undefined || value === "") return "-";
  if (type === "date") {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  }
  if (type === "currency") return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "percent") return `${Number(value).toFixed(2)}%`;
  if (type === "number") return Number(value).toLocaleString("en-IN");
  return String(value);
}

function columnWidth(count: number): string {
  return `${(100 / count).toFixed(4)}%`;
}

interface ReportPdfDocumentProps {
  descriptor: ReportDescriptor;
  orientation?: "portrait" | "landscape";
}

function ReportPdfDocument({ descriptor, orientation = "portrait" }: ReportPdfDocumentProps) {
  const width = columnWidth(descriptor.columns.length);
  const capped = descriptor.rows.length > EXPORT_ROW_CAP_PDF;
  const rows = capped ? descriptor.rows.slice(0, EXPORT_ROW_CAP_PDF) : descriptor.rows;

  return (
    <Document>
      <Page size="A4" orientation={orientation} style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.companyName}>{descriptor.companyName ?? "Fashion ERP"}</Text>
          <Text style={styles.title}>{descriptor.title}</Text>
          {descriptor.subtitle ? <Text style={styles.subtitle}>{descriptor.subtitle}</Text> : null}
          {descriptor.filtersApplied.length > 0 ? (
            <Text style={styles.filters}>Filters: {descriptor.filtersApplied.map((f) => `${f.label}: ${f.value}`).join("  |  ")}</Text>
          ) : null}
          <Text style={styles.meta}>
            Generated {descriptor.generatedAt} by {descriptor.generatedByName}
          </Text>
          <View style={styles.headerRule} />
        </View>

        {capped ? (
          <Text style={styles.cap}>
            Showing first {EXPORT_ROW_CAP_PDF.toLocaleString()} of {descriptor.rows.length.toLocaleString()} rows — export to Excel or CSV for the
            complete dataset.
          </Text>
        ) : null}

        <View style={styles.table}>
          <View style={styles.row} fixed>
            {descriptor.columns.map((col) => (
              <Text key={col.key} style={[styles.headerRowCell, { width, textAlign: col.align ?? "left" }]}>
                {col.label}
              </Text>
            ))}
          </View>
          {rows.map((row, index) => (
            <View style={styles.row} key={index} wrap={false}>
              {descriptor.columns.map((col) => (
                <Text key={col.key} style={[styles.cell, { width, textAlign: col.align ?? "left" }]}>
                  {formatCellValue(row[col.key], col.type)}
                </Text>
              ))}
            </View>
          ))}
          {descriptor.totals ? (
            <View style={styles.row}>
              {descriptor.columns.map((col) => (
                <Text key={col.key} style={[styles.totalsCell, { width, textAlign: col.align ?? "left" }]}>
                  {col.key in descriptor.totals! ? formatCellValue(descriptor.totals![col.key], col.type) : ""}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text>{descriptor.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Renders one ReportDescriptor to a PDF buffer via the one shared generic template. */
export async function renderReportPdf(descriptor: ReportDescriptor, options: { orientation?: "portrait" | "landscape" } = {}): Promise<Buffer> {
  const buffer = await renderToBuffer(<ReportPdfDocument descriptor={descriptor} orientation={options.orientation ?? "portrait"} />);
  return Buffer.from(buffer);
}

export function reportPdfHeaders(fileName: string) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}
