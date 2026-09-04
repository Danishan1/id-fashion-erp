import { prisma } from "@/core/db/client";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { saveFile } from "@/core/file-storage/FileStorage";
import { previewNextMasterCode } from "@/core/numbering/DocumentNumberingService";
import { getBulkImportQueue } from "@/core/jobs/queue";
import { customerSchema } from "@/modules/customers/customer.schema";
import { createCustomer, deactivateCustomer } from "@/modules/customers/customer.service";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { supplierSchema } from "@/modules/suppliers/supplier.schema";
import { createSupplier, deactivateSupplier } from "@/modules/suppliers/supplier.service";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { productSchema } from "@/modules/products/product.schema";
import { createProduct, createProductVariantExplicit, setProductActiveStatus, setProductVariantActiveStatus } from "@/modules/products/product.service";
import { ProductRepository, ProductVariantRepository } from "@/modules/products/product.repository";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { chartOfAccountSchema } from "@/modules/accounts/chart-of-account.schema";
import { createChartOfAccount, setChartOfAccountActiveStatus } from "@/modules/accounts/chart-of-account.service";
import { ChartOfAccountRepository } from "@/modules/accounts/chart-of-account.repository";
import { importOpeningStockRow } from "@/modules/inventory/inventory.service";
import { parseCsv } from "@/lib/csv";
import { parseXlsxBuffer } from "@/lib/xlsx-read";
import { BULK_IMPORT_COLUMNS, type BulkImportMasterType, type ImportColumnSpec } from "./import.schema";
import { ImportBatchRepository } from "./import.repository";
import { messageFromError, undefinedIfBlank } from "./import.service";

export interface BulkImportActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface BulkImportRowResult {
  recordId: string;
  tableName: string;
}

interface BulkImportRowFailure {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

interface RowContext {
  importBatchId: string;
  /** When true: resolve/validate everything a real commit would, including
   * the master's own duplicate-code check, but never call the real create
   * function or write anything. Placeholder recordIds are returned instead.
   *
   * This is NOT implemented via a Prisma transaction that gets rolled back —
   * an earlier version of this file tried exactly that
   * (`prisma.$transaction(async () => { await importRow(...); throw
   * RollbackSentinel })`) and it silently did NOT work: createCustomer/
   * createSupplier/createProduct/createProductVariantExplicit all write
   * through the shared `prisma` singleton directly, on their own connection,
   * not through the `tx` client the wrapping transaction handed out — so
   * the real writes committed immediately regardless of the outer
   * transaction's own outcome. Confirmed live: a "Validate" click alone
   * created real, permanent Customer rows. The safe fix is this explicit
   * dryRun flag — every handler branches before its own create call, never
   * after, so there is no write to roll back in the first place.
   */
  dryRun: boolean;
}

type BulkImportRowHandler = (actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext) => Promise<BulkImportRowResult>;

const DRY_RUN_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Per-master-type row handlers — each resolves its own real prerequisites
// (the spec's "foreign key checks" / "dependency order") and, in dryRun
// mode, runs the exact same duplicate-code check the real create function
// would (via that master's own repository), then stops short of writing.
// Outside dryRun, each calls the exact same create function the manual UI
// form already uses — auto-numbering and audit logging come from that
// underlying master's own service, unchanged.
// ---------------------------------------------------------------------------

async function importCustomerRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const code = undefinedIfBlank(raw.code) ?? (await previewNextMasterCode(actor.companyId, "CUSTOMER"));

  const input = customerSchema.parse({
    code,
    name: raw.name?.trim(),
    type: undefinedIfBlank(raw.type)?.toUpperCase(),
    country: raw.country?.trim() ?? "",
    taxRegistrationNo: raw.taxRegistrationNo?.trim() ?? "",
    billingAddress: raw.billingAddress?.trim() ?? "",
    shippingAddress: raw.shippingAddress?.trim() ?? "",
    paymentTermsDays: raw.paymentTermsDays,
    creditLimit: raw.creditLimit,
  });

  if (ctx.dryRun) {
    const existing = await CustomerRepository.findByCode(actor.companyId, input.code);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Customer code "${input.code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "customers" };
  }

  const customer = await createCustomer(actor, input);
  return { recordId: customer.id, tableName: "customers" };
}

async function resolveSupplierCategoryId(companyId: string, text: string): Promise<string> {
  const trimmed = text?.trim();
  if (!trimmed) throw new BusinessRuleError("VALIDATION_ERROR", "Category is required.");
  const category = await GarmentAttributeRepository.supplierCategory.findFirst({
    where: { companyId, OR: [{ code: trimmed }, { name: { equals: trimmed, mode: "insensitive" } }] },
  });
  if (!category) throw new BusinessRuleError("NOT_FOUND", `Supplier category "${trimmed}" not found.`);
  return category.id;
}

async function importSupplierRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const code = undefinedIfBlank(raw.code) ?? (await previewNextMasterCode(actor.companyId, "SUPPLIER"));
  const categoryId = await resolveSupplierCategoryId(actor.companyId, raw.category);

  const input = supplierSchema.parse({
    code,
    name: raw.name?.trim(),
    categoryId,
    contactPerson: raw.contactPerson?.trim() ?? "",
    email: raw.email?.trim() ?? "",
    phone: raw.phone?.trim() ?? "",
    address: raw.address?.trim() ?? "",
    taxRegistrationNo: raw.taxRegistrationNo?.trim() ?? "",
    paymentTermsDays: raw.paymentTermsDays,
  });

  if (ctx.dryRun) {
    const existing = await SupplierRepository.findByCode(actor.companyId, input.code);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "suppliers" };
  }

  const supplier = await createSupplier(actor, input);
  return { recordId: supplier.id, tableName: "suppliers" };
}

async function resolveOptionalId(
  companyId: string,
  text: string | undefined,
  find: (where: { companyId: string; code?: string; name?: { equals: string; mode: "insensitive" } }) => Promise<{ id: string } | null>,
  label: string
): Promise<string | undefined> {
  const trimmed = undefinedIfBlank(text);
  if (!trimmed) return undefined;
  const byCode = await find({ companyId, code: trimmed });
  if (byCode) return byCode.id;
  const byName = await find({ companyId, name: { equals: trimmed, mode: "insensitive" } });
  if (byName) return byName.id;
  throw new BusinessRuleError("NOT_FOUND", `${label} "${trimmed}" not found.`);
}

async function importProductRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const styleCode = undefinedIfBlank(raw.styleCode) ?? (await previewNextMasterCode(actor.companyId, "STYLE"));

  const [categoryId, seasonId] = await Promise.all([
    resolveOptionalId(actor.companyId, raw.category, (w) => GarmentAttributeRepository.category.findFirst({ where: w }), "Category"),
    resolveOptionalId(actor.companyId, raw.season, (w) => GarmentAttributeRepository.season.findFirst({ where: w }), "Season"),
  ]);

  const input = productSchema.parse({
    styleCode,
    styleName: raw.styleName?.trim(),
    categoryId: categoryId ?? "",
    seasonId: seasonId ?? "",
    hsnSacCode: raw.hsnSacCode?.trim() ?? "",
    unitCost: raw.unitCost,
  });

  if (ctx.dryRun) {
    const existing = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "products" };
  }

  const product = await createProduct(actor, input);
  return { recordId: product.id, tableName: "products" };
}

async function importProductVariantRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const styleCode = raw.styleCode?.trim();
  if (!styleCode) throw new BusinessRuleError("VALIDATION_ERROR", "Parent Style Code is required.");

  // The spec's explicit "must validate style code exists before allowing
  // variant import" — checked first, before resolving anything else, so a
  // missing-parent row always fails with this specific, actionable message.
  const product = await prisma.product.findFirst({ where: { companyId: actor.companyId, styleCode, itemType: "STYLE" } });
  if (!product) throw new BusinessRuleError("NOT_FOUND", `Parent style "${styleCode}" not found — import Product Master rows first.`);

  const colorId = await resolveOptionalId(actor.companyId, raw.color, (w) => prisma.color.findFirst({ where: w }), "Color");
  const sizeId = await resolveOptionalId(actor.companyId, raw.size, (w) => prisma.size.findFirst({ where: w }), "Size");
  if (!colorId) throw new BusinessRuleError("VALIDATION_ERROR", "Color is required.");
  if (!sizeId) throw new BusinessRuleError("VALIDATION_ERROR", "Size is required.");

  const skuCode = raw.skuCode?.trim();
  if (!skuCode) throw new BusinessRuleError("VALIDATION_ERROR", "SKU Code is required.");

  if (ctx.dryRun) {
    const existingSku = await ProductVariantRepository.findBySkuCode(skuCode);
    if (existingSku) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `SKU code "${skuCode}" is already in use.`);
    const existingCombo = await ProductVariantRepository.findByProductColorSize(product.id, colorId, sizeId);
    if (existingCombo) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", "A variant with this exact Style/Color/Size combination already exists.");
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "product_variants" };
  }

  const variant = await createProductVariantExplicit(actor, {
    productId: product.id,
    colorId,
    sizeId,
    skuCode,
    barcode: undefinedIfBlank(raw.barcode) ?? null,
  });
  return { recordId: variant.id, tableName: "product_variants" };
}

async function importOpeningStockRowHandler(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const skuCode = raw.skuCode?.trim();
  if (!skuCode) throw new BusinessRuleError("VALIDATION_ERROR", "SKU Code is required.");

  const variant = await prisma.productVariant.findUnique({ where: { skuCode }, include: { product: true } });
  if (!variant || variant.product.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", `SKU "${skuCode}" not found — import Product Variant rows first.`);
  }

  const warehouseText = raw.warehouse?.trim();
  if (!warehouseText) throw new BusinessRuleError("VALIDATION_ERROR", "Warehouse is required.");
  const warehouse = await prisma.warehouse.findFirst({
    where: { companyId: actor.companyId, OR: [{ code: warehouseText }, { name: { equals: warehouseText, mode: "insensitive" } }] },
  });
  if (!warehouse) throw new BusinessRuleError("NOT_FOUND", `Warehouse "${warehouseText}" not found.`);

  const quantity = Number(raw.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Quantity must be a positive number.");
  }

  // Unit Cost is deliberately not persisted anywhere from this row — there
  // is no per-transaction cost field on InventoryTransaction, and silently
  // overwriting Product.unitCost as a side effect of an unrelated Opening
  // Stock row would be a surprising, undocumented behavior. The column
  // exists on the template purely as a reference for whoever prepares the
  // file, matching this project's "don't invent a side effect nobody asked
  // for" discipline.

  if (ctx.dryRun) {
    // No duplicate-code concept for a ledger posting, and nothing else left
    // to check once SKU/warehouse/quantity all resolve — stop here rather
    // than actually posting the transaction (there's no "undo" for stock
    // movements in this app, so a validation-time post would be far worse
    // than a validation-time Customer/Supplier row, not just equally bad).
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "__opening_stock_ledger_entry__" };
  }

  await importOpeningStockRow(actor, {
    productId: variant.productId,
    warehouseId: warehouse.id,
    quantity,
    importBatchId: ctx.importBatchId,
  });

  // No single "opening stock record" id exists to track for Undo — the real
  // effect is a ledger entry + a StockBalance upsert, not a row with its own
  // id/deactivate path. Undo Batch skips OPENING_STOCK rows accordingly (see
  // undoBulkImportBatch below) — tracked here as a no-op placeholder so the
  // handler's return shape stays uniform.
  return { recordId: ctx.importBatchId, tableName: "__opening_stock_ledger_entry__" };
}

async function importChartOfAccountRow(actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext): Promise<BulkImportRowResult> {
  const input = chartOfAccountSchema.parse({
    code: raw.code?.trim(),
    name: raw.name?.trim(),
    accountType: undefinedIfBlank(raw.accountType)?.toUpperCase(),
  });

  if (ctx.dryRun) {
    const existing = await ChartOfAccountRepository.findByCode(actor.companyId, input.code);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Account code "${input.code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "chart_of_accounts" };
  }

  const account = await createChartOfAccount(actor, input);
  return { recordId: account.id, tableName: "chart_of_accounts" };
}

const BULK_IMPORTERS: Record<BulkImportMasterType, BulkImportRowHandler> = {
  CUSTOMER: importCustomerRow,
  SUPPLIER: importSupplierRow,
  PRODUCT: importProductRow,
  PRODUCT_VARIANT: importProductVariantRow,
  OPENING_STOCK: importOpeningStockRowHandler,
  CHART_OF_ACCOUNT: importChartOfAccountRow,
};

// ---------------------------------------------------------------------------
// File parsing — server-side (the old CRM import parses client-side and
// posts already-mapped JSON rows; this pipeline receives the raw file
// itself, since a validate-then-commit flow needs the server to be able to
// re-parse and re-validate without trusting anything the client computed).
// ---------------------------------------------------------------------------

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Matches an uploaded file's own header row to each column's key/label —
 * same normalize-and-compare heuristic already proven by CsvImportModal, so
 * a template downloaded from this feature and re-uploaded unmodified always
 * auto-maps with zero manual column-mapping step. */
function mapRowsToColumns(headerRow: string[], dataRows: string[][], columns: ImportColumnSpec[]): Record<string, string>[] {
  const headerIndexByColumnKey = new Map<string, number>();
  for (const col of columns) {
    const normalizedKey = normalizeHeader(col.key);
    const normalizedLabel = normalizeHeader(col.label.split("(")[0]);
    const idx = headerRow.findIndex((h) => {
      const normalizedHeader = normalizeHeader(h);
      const normalizedHeaderStripped = normalizeHeader(h.split("(")[0]);
      return normalizedHeader === normalizedKey || normalizedHeaderStripped === normalizedLabel || normalizedHeader === normalizedLabel;
    });
    if (idx >= 0) headerIndexByColumnKey.set(col.key, idx);
  }

  const missingRequired = columns.filter((c) => c.required && !headerIndexByColumnKey.has(c.key));
  if (missingRequired.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `The file is missing required column(s): ${missingRequired.map((c) => c.label).join(", ")}. Download the template for the exact expected headers.`
    );
  }

  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    for (const [key, idx] of headerIndexByColumnKey) {
      obj[key] = row[idx] ?? "";
    }
    return obj;
  });
}

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Browsers are inconsistent about what `File.type` reports for a .csv
 * selection (some report `text/csv`, some report `application/vnd.ms-excel`,
 * some report an empty string) — resolving primarily by file extension, with
 * the browser-supplied MIME type only as a fallback, is what actually works
 * reliably across browsers for this two-format-only feature.
 */
export function resolveUploadedFileMimeType(fileName: string, browserMimeType: string): string {
  if (fileName.toLowerCase().endsWith(".csv")) return "text/csv";
  if (browserMimeType === "text/csv") return "text/csv";
  return XLSX_MIME_TYPE;
}

export async function parseUploadedFile(
  buffer: Buffer,
  mimeType: string,
  masterType: BulkImportMasterType
): Promise<{ rows: Record<string, string>[]; totalRows: number }> {
  const columns = BULK_IMPORT_COLUMNS[masterType];
  let headerRow: string[];
  let dataRows: string[][];

  if (mimeType === "text/csv") {
    const parsed = parseCsv(buffer.toString("utf-8"));
    if (parsed.length < 1) throw new BusinessRuleError("VALIDATION_ERROR", "The file appears to be empty.");
    [headerRow, ...dataRows] = parsed;
  } else {
    const sheet = await parseXlsxBuffer(buffer);
    if (sheet.length < 1) throw new BusinessRuleError("VALIDATION_ERROR", "The file appears to be empty.");
    [headerRow, ...dataRows] = sheet;
  }

  if (dataRows.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The file has a header row but no data rows.");
  }
  if (dataRows.length > 10000) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A single import is capped at 10,000 rows (this file has ${dataRows.length}).`);
  }

  const rows = mapRowsToColumns(headerRow, dataRows, columns);
  return { rows, totalRows: rows.length };
}

// ---------------------------------------------------------------------------
// Validate (dry-run, no writes) / Commit (enqueue) / Undo
// ---------------------------------------------------------------------------

export interface BulkImportValidationResult {
  totalRows: number;
  validCount: number;
  errors: { rowNumber: number; reason: string }[];
}

/**
 * Dry-run only — every handler is called with ctx.dryRun=true, which routes
 * it through the same resolution/Zod-schema/duplicate-code logic a real
 * commit would use but stops before ever calling the actual create function
 * (see RowContext's own doc comment for why an outer Prisma transaction
 * can't be used to fake this safely). Two rows in the same file both
 * claiming the same brand-new code will both "validate" fine here, then the
 * second will fail at commit time — an accepted, documented gap, matching
 * this project's own per-row-isolation precedent that already treats a
 * same-batch collision as a normal, reportable per-row failure rather than
 * something that must be caught before commit.
 */
export async function validateBulkImportRows(
  actor: BulkImportActorContext,
  masterType: BulkImportMasterType,
  rows: Record<string, string>[]
): Promise<BulkImportValidationResult> {
  const errors: { rowNumber: number; reason: string }[] = [];
  const importRow = BULK_IMPORTERS[masterType];

  for (let i = 0; i < rows.length; i++) {
    try {
      await importRow(actor, rows[i], { importBatchId: DRY_RUN_PLACEHOLDER_ID, dryRun: true });
    } catch (error) {
      errors.push({ rowNumber: i + 1, reason: messageFromError(error) });
    }
  }

  return { totalRows: rows.length, validCount: rows.length - errors.length, errors };
}

export async function commitBulkImport(
  actor: BulkImportActorContext,
  masterType: BulkImportMasterType,
  fileName: string,
  fileBuffer: Buffer,
  fileMimeType: string,
  rows: Record<string, string>[]
): Promise<{ batchId: string; jobId: string }> {
  let originalFileKey: string | null = null;
  try {
    const stored = await saveFile(fileBuffer, fileName, fileMimeType);
    originalFileKey = stored.storageKey;
  } catch {
    // Non-fatal — the import still proceeds even if the original file
    // can't be persisted for audit (e.g. an allow-listed type that still
    // fails the magic-byte check for some other reason); losing the audit
    // copy is a lesser failure than blocking the whole import over it.
    originalFileKey = null;
  }

  const batch = await ImportBatchRepository.createQueued({
    companyId: actor.companyId,
    importType: masterType,
    fileName,
    totalRows: rows.length,
    originalFileKey,
    createdByUserId: actor.userId,
  });

  const job = await getBulkImportQueue().add(masterType, { batchId: batch.id, masterType, actor, rows });
  await ImportBatchRepository.setJobId(batch.id, job.id ?? "");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "import_batches",
    recordId: batch.id,
    action: "CREATE",
    newValues: { importType: masterType, fileName, totalRows: rows.length, status: "QUEUED" },
  });

  return { batchId: batch.id, jobId: job.id ?? "" };
}

/**
 * Runs entirely inside the worker process (src/core/jobs/worker.ts) — never
 * called from an API route. Per-row isolation, matching the CRM import's
 * own runImport(): a bad row is reported, not fatal to the whole batch.
 */
export async function processBulkImportJob(
  batchId: string,
  masterType: BulkImportMasterType,
  actor: BulkImportActorContext,
  rows: Record<string, string>[],
  onProgress: (processed: number, total: number) => Promise<void>
): Promise<void> {
  await ImportBatchRepository.setStatus(batchId, "PROCESSING");

  const importRow = BULK_IMPORTERS[masterType];
  const failedRows: BulkImportRowFailure[] = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    try {
      const result = await importRow(actor, raw, { importBatchId: batchId, dryRun: false });
      if (result.tableName !== "__opening_stock_ledger_entry__") {
        await ImportBatchRepository.addRecord({ importBatchId: batchId, rowNumber: i + 1, tableName: result.tableName, recordId: result.recordId });
      }
      importedCount++;
    } catch (error) {
      failedRows.push({ rowNumber: i + 1, data: raw, reason: messageFromError(error) });
    }
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      await onProgress(i + 1, rows.length);
    }
  }

  await ImportBatchRepository.finalize(batchId, {
    importedCount,
    skippedCount: failedRows.length,
    failedRowsJson: failedRows.length > 0 ? (failedRows as unknown as Prisma.InputJsonValue) : null,
    status: "COMPLETED",
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "import_batches",
    recordId: batchId,
    action: "UPDATE",
    newValues: { status: "COMPLETED", importedCount, skippedCount: failedRows.length },
  });
}

const DEACTIVATE_BY_TABLE: Record<string, (actor: BulkImportActorContext, id: string) => Promise<unknown>> = {
  customers: (actor, id) => deactivateCustomer(actor, id),
  suppliers: (actor, id) => deactivateSupplier(actor, id),
  products: (actor, id) => setProductActiveStatus(actor, id, false),
  product_variants: (actor, id) => setProductVariantActiveStatus(actor, id, false),
  chart_of_accounts: (actor, id) => setChartOfAccountActiveStatus(actor, id, false),
};

export async function undoBulkImportBatch(actor: BulkImportActorContext, batchId: string) {
  const batch = await ImportBatchRepository.findByIdWithDetails(actor.companyId, batchId);
  if (!batch) throw new BusinessRuleError("NOT_FOUND", "Import batch not found.", { id: batchId });
  if (batch.status === "UNDONE") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This batch has already been undone.");
  }
  if (batch.status !== "COMPLETED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot undo a batch that is still "${batch.status}".`);
  }

  const records = await ImportBatchRepository.findRecordsForBatch(batchId);
  const results: { recordId: string; tableName: string; ok: boolean; reason?: string }[] = [];

  for (const record of records) {
    const deactivate = DEACTIVATE_BY_TABLE[record.tableName];
    if (!deactivate) {
      results.push({ recordId: record.recordId, tableName: record.tableName, ok: false, reason: "No undo path for this record type." });
      continue;
    }
    try {
      await deactivate(actor, record.recordId);
      results.push({ recordId: record.recordId, tableName: record.tableName, ok: true });
    } catch (error) {
      results.push({ recordId: record.recordId, tableName: record.tableName, ok: false, reason: messageFromError(error) });
    }
  }

  await ImportBatchRepository.setStatus(batchId, "UNDONE");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "import_batches",
    recordId: batchId,
    action: "UPDATE",
    newValues: { status: "UNDONE", undoneRecordCount: records.length },
  });

  return { totalRecords: records.length, undone: results.filter((r) => r.ok).length, failures: results.filter((r) => !r.ok) };
}
