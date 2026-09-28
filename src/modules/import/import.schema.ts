import { z } from "zod";

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
  // Tier 1 + Tier 2 masters added 2026-09-05 — small/simple lookup masters
  // that were previously only reachable one row at a time via
  // SimpleLookupManager.
  "COLOR",
  "SIZE",
  "UNIT",
  "BRAND",
  "SEASON",
  "PRODUCT_FITTING",
  "PRODUCT_TYPE",
  "DESIGN",
  "DESIGN_PATTERN",
  "PATTERN",
  "SUPPLIER_CATEGORY",
  "FABRIC_GSM",
  "FABRIC_DYE_TYPE",
  "FABRIC_WEAVE_TYPE",
  "FABRIC_COMPOSITION",
  "EMPLOYEE_CATEGORY",
  "COST_MASTER",
  "PAYMENT_TYPE",
  "DEPARTMENT",
  "CATEGORY",
  "FABRIC_DYE",
  "FABRIC_WIDTH",
  "DESIGNATION",
  "SHIFT_MASTER",
  "HOLIDAY_MASTER",
  "PRODUCTION_STAGE",
  "PRODUCTION_LINE",
  "MACHINE",
  "SALES_AGENT",
  "BANK_ACCOUNT",
  "MATERIAL",
  // Warehouse+WarehouseLocation (nested parent/child) and Employee
  // (self-referencing reportsToId) were originally deferred pending their
  // own design pass — resolved 2026-09-05 by mirroring the exact
  // PRODUCT->PRODUCT_VARIANT two-tier pattern already proven above: WAREHOUSE
  // creates the warehouse alone (no inline locations, unlike the manual
  // Create-modal's own nested-write UI — a flat CSV row has nowhere to stage
  // a variable-length location list), WAREHOUSE_LOCATION adds one location
  // to an already-existing warehouse referenced by code. EMPLOYEE's
  // reportsTo (manager) column resolves by employee code, same in-order/
  // same-file-caveat as CATEGORY's own self-referencing parent above.
  "WAREHOUSE",
  "WAREHOUSE_LOCATION",
  "EMPLOYEE",
] as const;
export type BulkImportMasterType = (typeof BULK_IMPORT_MASTER_TYPES)[number];

// Dependency order the spec explicitly asks for -- Product Variant rows
// need their parent Style to already exist, Opening Stock rows need their
// SKU (a Product Variant) and Warehouse to already exist. The UI presents
// tabs in this order; validation independently re-checks each real
// prerequisite regardless of what order a Super Admin actually uploads in.
//
// The Tier 1/2 masters added 2026-09-05 slot in wherever they have a real
// FK prerequisite among this same list (Unit before Fabric Width/Material,
// Department before Designation, Fabric Dye Type before Fabric Dye,
// Supplier before Material, Category supports a self-referencing parent so
// is listed early but a same-file parent+child pair still only resolves at
// commit time, not at validate time — see importCategoryRow's own comment).
// Everything else with no real prerequisite is grouped after its own
// module's simplest entities, matching BULK_IMPORT_MASTER_TYPES' own order.
export const BULK_IMPORT_DEPENDENCY_ORDER: BulkImportMasterType[] = [
  "CUSTOMER",
  "SUPPLIER",
  "UNIT",
  "COLOR",
  "SIZE",
  "BRAND",
  "SEASON",
  "PRODUCT_FITTING",
  "PRODUCT_TYPE",
  "DESIGN",
  "DESIGN_PATTERN",
  "PATTERN",
  "CATEGORY",
  "SUPPLIER_CATEGORY",
  "FABRIC_GSM",
  "FABRIC_DYE_TYPE",
  "FABRIC_DYE",
  "FABRIC_WEAVE_TYPE",
  "FABRIC_WIDTH",
  "FABRIC_COMPOSITION",
  "DEPARTMENT",
  "DESIGNATION",
  "EMPLOYEE_CATEGORY",
  "SHIFT_MASTER",
  "EMPLOYEE",
  "HOLIDAY_MASTER",
  "PRODUCTION_STAGE",
  "PRODUCTION_LINE",
  "MACHINE",
  "SALES_AGENT",
  "COST_MASTER",
  "PAYMENT_TYPE",
  "BANK_ACCOUNT",
  "WAREHOUSE",
  "WAREHOUSE_LOCATION",
  "PRODUCT",
  "MATERIAL",
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
    { key: "parentAccount", label: "Parent Account (existing account code or name, optional)", required: false },
  ],

  // ── Tier 1 + Tier 2 masters (2026-09-05) ──────────────────────────────
  COLOR: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "hexValue", label: "Hex Value (e.g. #FF0000)", required: false },
  ],
  SIZE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "sortOrder", label: "Sort Order", required: false },
  ],
  UNIT: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "conversionFactor", label: "Conversion Factor", required: false },
    { key: "baseUnit", label: "Base Unit (existing unit code, optional)", required: false },
  ],
  BRAND: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  SEASON: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  PRODUCT_FITTING: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  PRODUCT_TYPE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  DESIGN: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  DESIGN_PATTERN: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  PATTERN: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  SUPPLIER_CATEGORY: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  FABRIC_GSM: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  FABRIC_DYE_TYPE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  FABRIC_WEAVE_TYPE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  FABRIC_COMPOSITION: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  EMPLOYEE_CATEGORY: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  COST_MASTER: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type (HOURLY/MONTHLY/PER_UNIT/FIXED/PERCENTAGE)", required: false },
    { key: "rate", label: "Rate", required: true },
  ],
  PAYMENT_TYPE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type (CASH/BANK/CHEQUE/CARD/UPI/OTHER)", required: false },
  ],
  DEPARTMENT: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
  ],
  CATEGORY: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "parentCategory", label: "Parent Category (existing category code or name, optional)", required: false },
  ],
  FABRIC_DYE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "pantone", label: "Pantone", required: false },
    { key: "dyeType", label: "Dye Type (existing dye type code or name, optional)", required: false },
  ],
  FABRIC_WIDTH: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "unit", label: "Unit (existing unit code or name, optional)", required: false },
  ],
  DESIGNATION: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "department", label: "Department (existing department code or name, optional)", required: false },
  ],
  SHIFT_MASTER: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "startTime", label: "Start Time (e.g. 09:00)", required: true },
    { key: "endTime", label: "End Time (e.g. 18:00)", required: true },
    { key: "graceMinutes", label: "Grace Minutes", required: false },
  ],
  HOLIDAY_MASTER: [
    { key: "name", label: "Holiday Name", required: true },
    { key: "date", label: "Date (YYYY-MM-DD)", required: true },
  ],
  PRODUCTION_STAGE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "sequence", label: "Sequence", required: false },
    { key: "isFinal", label: "Is Final Stage (true/false)", required: false },
    { key: "allowRework", label: "Allow Rework (true/false)", required: false },
    { key: "allowsExtraQuantity", label: "Allows Extra Pieces (true/false)", required: false },
  ],
  PRODUCTION_LINE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "capacityPerDay", label: "Capacity Per Day", required: false },
  ],
  MACHINE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "productionLine", label: "Production Line (existing line code or name, optional)", required: false },
    { key: "machineType", label: "Machine Type", required: false },
  ],
  SALES_AGENT: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "contactPerson", label: "Contact Person", required: false },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "commissionPercent", label: "Commission %", required: false },
  ],
  BANK_ACCOUNT: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "bankName", label: "Bank Name", required: true },
    { key: "accountNumber", label: "Account Number", required: true },
    { key: "ifscCode", label: "IFSC Code", required: false },
    { key: "branch", label: "Branch", required: false },
    { key: "accountHolderName", label: "Account Holder Name", required: false },
    { key: "upiId", label: "UPI ID", required: false },
  ],
  MATERIAL: [
    { key: "styleCode", label: "Item Code (leave blank to auto-generate)", required: false },
    { key: "styleName", label: "Name", required: true },
    { key: "materialCategory", label: "Category (FABRIC/TRIMS/ZIPS/BUTTONS/ACCESSORIES/PACKAGING/OTHER)", required: true },
    { key: "baseUnit", label: "Base Unit (existing unit code or name, optional)", required: false },
    { key: "defaultSupplier", label: "Default Supplier (existing supplier code or name, optional)", required: false },
    { key: "reorderLevel", label: "Reorder Level", required: false },
    { key: "unitCost", label: "Unit Cost", required: false },
    { key: "hsnSacCode", label: "HSN/SAC Code", required: false },
  ],

  // ── Warehouse + Employee (2026-09-05) ─────────────────────────────────
  WAREHOUSE: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    {
      key: "type",
      label: "Type(s) — comma-separated (RAW_MATERIAL/FABRIC/TRIMS/WIP/FINISHED_GOODS/DISPATCH/REJECT)",
      required: true,
    },
  ],
  WAREHOUSE_LOCATION: [
    { key: "warehouse", label: "Warehouse (existing warehouse code, must already exist)", required: true },
    { key: "code", label: "Location Code", required: true },
    { key: "zone", label: "Zone", required: false },
    { key: "rack", label: "Rack", required: false },
    { key: "bin", label: "Bin", required: false },
    {
      key: "materialCategory",
      label: "Category (FABRIC/TRIMS/ZIPS/BUTTONS/ACCESSORIES/PACKAGING/OTHER/WIP/FINISHED_GOODS/DISPATCH/REJECT, optional)",
      required: false,
    },
  ],
  EMPLOYEE: [
    { key: "employeeCode", label: "Employee Code (leave blank to auto-generate)", required: false },
    { key: "fullName", label: "Full Name", required: true },
    { key: "department", label: "Department (existing department code or name, optional)", required: false },
    { key: "designation", label: "Designation (existing designation code or name, optional)", required: false },
    { key: "employeeCategory", label: "Employee Category (existing category code or name, optional)", required: false },
    { key: "shift", label: "Shift (existing shift code or name, optional)", required: false },
    { key: "reportsTo", label: "Reports To (existing employee code, optional)", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "email", label: "Email", required: false },
    { key: "joinDate", label: "Join Date (YYYY-MM-DD)", required: false },
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
    parentAccount: "",
  },

  COLOR: { code: "SMPL-CLR", name: "Sample Navy Blue", hexValue: "#1F2A44" },
  SIZE: { code: "SMPL-SZ", name: "Sample Medium", sortOrder: "10" },
  UNIT: { code: "SMPL-UNT", name: "Sample Dozen", conversionFactor: "12", baseUnit: "" },
  BRAND: { code: "SMPL-BRND", name: "Sample Brand" },
  SEASON: { code: "SMPL-SSN", name: "Sample Spring/Summer" },
  PRODUCT_FITTING: { code: "SMPL-FIT", name: "Sample Slim Fit" },
  PRODUCT_TYPE: { code: "SMPL-PT", name: "Sample Knitwear" },
  DESIGN: { code: "SMPL-DSN", name: "Sample Floral" },
  DESIGN_PATTERN: { code: "SMPL-DP", name: "Sample Checked" },
  PATTERN: { code: "SMPL-PTRN", name: "Sample Striped" },
  SUPPLIER_CATEGORY: { code: "SMPL-SC", name: "Sample Packaging" },
  FABRIC_GSM: { code: "SMPL-GSM", name: "Sample 180 GSM" },
  FABRIC_DYE_TYPE: { code: "SMPL-DT", name: "Sample Reactive" },
  FABRIC_WEAVE_TYPE: { code: "SMPL-WV", name: "Sample Plain Weave" },
  FABRIC_COMPOSITION: { code: "SMPL-CMP", name: "Sample 100% Cotton" },
  EMPLOYEE_CATEGORY: { code: "SMPL-EC", name: "Sample Contract Staff" },
  COST_MASTER: { code: "SMPL-CM", name: "Sample Overhead Rate", type: "PER_UNIT", rate: "5" },
  PAYMENT_TYPE: { code: "SMPL-PAY", name: "Sample UPI", type: "UPI" },
  DEPARTMENT: { code: "SMPL-DPT", name: "Sample Quality Control" },
  CATEGORY: { code: "SMPL-CAT", name: "Sample Casual Wear", parentCategory: "" },
  FABRIC_DYE: { code: "SMPL-DYE", name: "Sample Indigo", pantone: "19-3921 TCX", dyeType: "" },
  FABRIC_WIDTH: { code: "SMPL-WD", name: "Sample 150 cm", unit: "" },
  DESIGNATION: { code: "SMPL-DSG", name: "Sample Line Supervisor", department: "" },
  SHIFT_MASTER: { code: "SMPL-SHFT", name: "Sample Day Shift", startTime: "09:00", endTime: "18:00", graceMinutes: "10" },
  HOLIDAY_MASTER: { name: "Sample Republic Day", date: "2027-01-26" },
  PRODUCTION_STAGE: { code: "SMPL-STG", name: "Sample Embroidery", sequence: "5", isFinal: "false", allowRework: "true" },
  PRODUCTION_LINE: { code: "SMPL-LN", name: "Sample Line 3", capacityPerDay: "500" },
  MACHINE: { code: "SMPL-MC", name: "Sample Overlock Machine", productionLine: "", machineType: "Overlock" },
  SALES_AGENT: { code: "SMPL-AGT", name: "Sample Agent", contactPerson: "Anil Kumar", email: "anil@sampleagent.example", phone: "9123456780", commissionPercent: "3" },
  BANK_ACCOUNT: {
    code: "SMPL-BNK",
    name: "Sample Current Account",
    bankName: "Sample Bank of India",
    accountNumber: "123456789012",
    ifscCode: "SBIN0001234",
    branch: "Sample Branch",
    accountHolderName: "Sample Apparel Manufacturing Pvt Ltd",
    upiId: "",
  },
  MATERIAL: {
    styleCode: "",
    styleName: "Sample Interlining Fabric",
    materialCategory: "FABRIC",
    baseUnit: "",
    defaultSupplier: "",
    reorderLevel: "50",
    unitCost: "80",
    hsnSacCode: "59039090",
  },

  WAREHOUSE: { code: "SMPL-WH", name: "Sample Warehouse", type: "RAW_MATERIAL,FABRIC" },
  WAREHOUSE_LOCATION: { warehouse: "", code: "SMPL-LOC", zone: "A", rack: "A1", bin: "", materialCategory: "" },
  EMPLOYEE: {
    employeeCode: "",
    fullName: "Sample Employee",
    department: "",
    designation: "",
    employeeCategory: "",
    shift: "",
    reportsTo: "",
    phone: "9876543210",
    email: "sample.employee@example.com",
    joinDate: "2026-09-05",
  },
};

export const IMPORT_COLUMNS: Record<ImportBatchTypeValue, ImportColumnSpec[]> = {
  LEAD: [
    { key: "name", label: "Name", required: true },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "companyName", label: "Company Name", required: false },
    { key: "whatsappNumber", label: "WhatsApp Number", required: false },
    { key: "country", label: "Country", required: false },
    { key: "city", label: "City", required: false },
    { key: "source", label: "Source (code or name from CRM Settings, e.g. WEBSITE)", required: false },
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
