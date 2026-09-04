import { z } from "zod";
import { LEAD_SOURCES } from "@/modules/crm/lead.schema";

export const IMPORT_BATCH_TYPES = ["LEAD", "DEAL", "CAMPAIGN_DAILY_METRIC"] as const;
export type ImportBatchTypeValue = (typeof IMPORT_BATCH_TYPES)[number];

// Super Admin -> Bulk Master Data Import portal (2026-09-04) -- a distinct
// set from IMPORT_BATCH_TYPES above (the original synchronous CRM import),
// since these run through the async Redis/BullMQ pipeline instead. Kept as
// a separate const rather than folded into IMPORT_BATCH_TYPES so the two
// pipelines' own UIs/routes can each iterate just their own set.
export const BULK_IMPORT_MASTER_TYPES = [
  "CUSTOMER",
  "SUPPLIER",
  "PRODUCT",
  "PRODUCT_VARIANT",
  "OPENING_STOCK",
  "CHART_OF_ACCOUNT",
] as const;
export type BulkImportMasterType = (typeof BULK_IMPORT_MASTER_TYPES)[number];

// Dependency order the spec explicitly asks for -- Product Variant rows
// need their parent Style to already exist, Opening Stock rows need their
// SKU (a Product Variant) and Warehouse to already exist. The UI presents
// tabs in this order; validation independently re-checks each real
// prerequisite regardless of what order a Super Admin actually uploads in.
export const BULK_IMPORT_DEPENDENCY_ORDER: BulkImportMasterType[] = [
  "CUSTOMER",
  "SUPPLIER",
  "PRODUCT",
  "PRODUCT_VARIANT",
  "OPENING_STOCK",
  "CHART_OF_ACCOUNT",
];

// One canonical column spec per import type — the single source of truth
// shared by the server-side row validator below AND the client-side
// column-mapping UI / downloadable template (CsvImportModal reads the same
// `key`/`label`/`required` shape, so the two can never silently drift).
export interface ImportColumnSpec {
  key: string;
  label: string;
  required: boolean;
}

// Bulk Master Data Import's own column specs (2026-09-04) — kept in a
// separate map from IMPORT_COLUMNS below since they key on
// BulkImportMasterType, not ImportBatchTypeValue, and each row is
// server-parsed (xlsx/csv), not client-mapped like the CRM importer's own
// flow. A header in the uploaded file is matched to a column by the same
// normalize-and-compare heuristic already proven by CsvImportModal
// (case/punctuation-insensitive, strips a trailing parenthetical hint) —
// see import.service.ts's matchColumnsToHeaders().
//
// Several spec-requested columns have no home in this schema today and are
// deliberately NOT listed here rather than silently invented as new fields:
// Customer has no "Contact Person" field (only its child Buyer records do —
// add a Buyer manually after import if reachability is needed); Product has
// no "Sub-Category" concept anywhere in this app. Opening Stock's "Unit
// Cost" column is intentionally NOT wired to anything — see importRow's own
// comment in import.service.ts.
export const BULK_IMPORT_COLUMNS: Record<BulkImportMasterType, ImportColumnSpec[]> = {
  CUSTOMER: [
    { key: "code", label: "Code (leave blank to auto-generate)", required: false },
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type (CUSTOMER/AGENT)", required: false },
    { key: "country", label: "Country", required: false },
    { key: "taxRegistrationNo", label: "GST / Tax ID", required: false },
    { key: "billingAddress", label: "Billing Address", required: false },
    { key: "shippingAddress", label: "Shipping Address", required: false },
    { key: "paymentTermsDays", label: "Payment Terms (Days)", required: false },
    { key: "creditLimit", label: "Credit Limit", required: false },
  ],
  SUPPLIER: [
    { key: "code", label: "Code (leave blank to auto-generate)", required: false },
    { key: "name", label: "Name", required: true },
    { key: "category", label: "Category (existing Supplier Category code or name)", required: true },
    { key: "contactPerson", label: "Contact Person", required: false },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "address", label: "Address", required: false },
    { key: "taxRegistrationNo", label: "GST / Tax ID", required: false },
    { key: "paymentTermsDays", label: "Payment Terms (Days)", required: false },
  ],
  PRODUCT: [
    { key: "styleCode", label: "Style Code (leave blank to auto-generate)", required: false },
    { key: "styleName", label: "Style Name", required: true },
    { key: "category", label: "Category (existing category code or name, optional)", required: false },
    { key: "season", label: "Season (existing season code or name, optional)", required: false },
    { key: "hsnSacCode", label: "HSN/SAC Code", required: false },
    { key: "unitCost", label: "Cost Price", required: false },
  ],
  PRODUCT_VARIANT: [
    { key: "styleCode", label: "Parent Style Code (must already exist)", required: true },
    { key: "color", label: "Color (existing color code or name)", required: true },
    { key: "size", label: "Size (existing size code or name)", required: true },
    { key: "skuCode", label: "SKU Code", required: true },
    { key: "barcode", label: "Barcode", required: false },
  ],
  OPENING_STOCK: [
    { key: "skuCode", label: "SKU Code (must already exist)", required: true },
    { key: "warehouse", label: "Warehouse (existing warehouse code or name)", required: true },
    { key: "quantity", label: "Quantity", required: true },
    { key: "unitCost", label: "Unit Cost (reference only — not stored)", required: false },
  ],
  CHART_OF_ACCOUNT: [
    { key: "code", label: "Account Code", required: true },
    { key: "name", label: "Account Name", required: true },
    { key: "accountType", label: "Account Type (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE)", required: true },
  ],
};

// One realistic sample row per master type, keyed by the same column `key`s
// as BULK_IMPORT_COLUMNS above — used only to populate the downloadable
// template's second row so a first-time user has a concrete, plausible
// example to follow (and can literally re-upload the template unmodified as
// a smoke test). These are illustrative only; they are not re-validated
// against real masters (e.g. "India" as a Customer's Country is a plain
// free-text example, not a claim that a "India" row exists in every tenant).
export const BULK_IMPORT_SAMPLE_ROWS: Record<BulkImportMasterType, Record<string, string>> = {
  CUSTOMER: {
    code: "",
    name: "Sample Apparel Buyers Ltd",
    type: "CUSTOMER",
    country: "India",
    taxRegistrationNo: "22AAAAA0000A1Z5",
    billingAddress: "123 Industrial Area, Mumbai",
    shippingAddress: "123 Industrial Area, Mumbai",
    paymentTermsDays: "30",
    creditLimit: "500000",
  },
  SUPPLIER: {
    code: "",
    name: "Sample Fabric Suppliers Pvt Ltd",
    category: "Fabric",
    contactPerson: "Rakesh Sharma",
    email: "rakesh@samplefabrics.example",
    phone: "9876543210",
    address: "Plot 12, Textile Park, Surat",
    taxRegistrationNo: "24BBBBB1111B2Z6",
    paymentTermsDays: "45",
  },
  PRODUCT: {
    styleCode: "",
    styleName: "Sample Round Neck T-Shirt",
    category: "",
    season: "",
    hsnSacCode: "61091000",
    unitCost: "250",
  },
  PRODUCT_VARIANT: {
    styleCode: "ST-00001",
    color: "Black",
    size: "M",
    skuCode: "ST-00001-BLK-M",
    barcode: "",
  },
  OPENING_STOCK: {
    skuCode: "ST-00001-BLK-M",
    warehouse: "",
    quantity: "100",
    unitCost: "250",
  },
  CHART_OF_ACCOUNT: {
    code: "1999",
    name: "Sample Reserve Account",
    accountType: "ASSET",
  },
};

export const IMPORT_COLUMNS: Record<ImportBatchTypeValue, ImportColumnSpec[]> = {
  LEAD: [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "companyName", label: "Company Name", required: false },
    { key: "source", label: `Source (${LEAD_SOURCES.join("/")})`, required: false },
    { key: "leadScore", label: "Lead Score (0-100)", required: false },
    { key: "value", label: "Potential Value", required: false },
    { key: "expectedCloseDate", label: "Expected Close Date (YYYY-MM-DD)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  DEAL: [
    { key: "title", label: "Deal Title", required: true },
    { key: "leadNumber", label: "Lead # (optional link)", required: false },
    { key: "customerCode", label: "Customer Code (optional link)", required: false },
    { key: "value", label: "Value", required: false },
    { key: "probabilityPercent", label: "Probability % (0-100)", required: false },
    { key: "expectedCloseDate", label: "Expected Close Date (YYYY-MM-DD)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  CAMPAIGN_DAILY_METRIC: [
    { key: "campaignNumber", label: "Campaign # (e.g. CAM-2026-00001)", required: false },
    { key: "campaignName", label: "Campaign Name (used only if Campaign # is blank)", required: false },
    { key: "metricDate", label: "Metric Date (YYYY-MM-DD)", required: true },
    { key: "spend", label: "Spend", required: false },
    { key: "impressions", label: "Impressions", required: false },
    { key: "clicks", label: "Clicks", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
};

// Deliberately no separate per-row Zod schema here — import.service.ts
// validates each row by feeding it straight into the exact same
// createLeadSchema/createDealSchema/recordDailyMetricSchema the manual UI
// forms already use, so a CSV-imported record can never diverge from a
// manually-created one's validation rules.

export const runImportSchema = z.object({
  importType: z.enum(IMPORT_BATCH_TYPES),
  fileName: z.string().min(1).max(255),
  // Already column-mapped client-side into canonical keys — every value is
  // still a raw string (as read from the CSV cell); per-row Zod coercion
  // happens server-side, never trusted from the client.
  rows: z.array(z.record(z.string(), z.string())).min(1, "The file has no data rows.").max(5000, "A single import is capped at 5000 rows."),
});
export type RunImportInput = z.infer<typeof runImportSchema>;
