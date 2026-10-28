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
import { MATERIAL_CATEGORIES, materialSchema, productSchema } from "@/modules/products/product.schema";
import { createProduct, createProductVariantExplicit, setProductActiveStatus, setProductVariantActiveStatus } from "@/modules/products/product.service";
import { ProductRepository, ProductVariantRepository } from "@/modules/products/product.repository";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { chartOfAccountSchema } from "@/modules/accounts/chart-of-account.schema";
import { createChartOfAccount, setChartOfAccountActiveStatus } from "@/modules/accounts/chart-of-account.service";
import { ChartOfAccountRepository } from "@/modules/accounts/chart-of-account.repository";
import { importOpeningStockRow } from "@/modules/inventory/inventory.service";
import { createMaterial } from "@/modules/products/product.service";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { createColor, createSize, createUnit } from "@/modules/lookups/lookup.service";
import {
  createBrand,
  createCategory,
  createDesign,
  createDesignPattern,
  createPattern,
  createProductFitting,
  createProductType,
  createSeason,
  createSupplierCategory,
} from "@/modules/garment-attributes/garment-attributes.service";
import { FabricConfigRepository } from "@/modules/fabric-config/fabric-config.repository";
import {
  createFabricComposition,
  createFabricDye,
  createFabricDyeType,
  createFabricGsm,
  createFabricWeaveType,
  createFabricWidth,
} from "@/modules/fabric-config/fabric-config.service";
import { HrConfigRepository } from "@/modules/hr-config/hr-config.repository";
import { createDesignation, createEmployeeCategory, createHolidayMaster, createShiftMaster } from "@/modules/hr-config/hr-config.service";
import { CostMasterRepository } from "@/modules/cost-master/cost-master.repository";
import { createCostMaster } from "@/modules/cost-master/cost-master.service";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import { createBankAccount, createPaymentType } from "@/modules/finance-config/finance-config.service";
import { DepartmentRepository } from "@/modules/departments/department.repository";
import { createDepartment } from "@/modules/departments/department.service";
import { WarehouseRepository, WarehouseLocationRepository } from "@/modules/warehouses/warehouse.repository";
import { createWarehouse, createWarehouseLocation, setWarehouseActiveStatus, setWarehouseLocationActiveStatus } from "@/modules/warehouses/warehouse.service";
import { WAREHOUSE_TYPES, LOCATION_MATERIAL_CATEGORIES } from "@/modules/warehouses/warehouse.schema";
import { EmployeeRepository } from "@/modules/employees/employee.repository";
import { createEmployee, deactivateEmployee } from "@/modules/employees/employee.service";
import { ProductionConfigRepository } from "@/modules/production-config/production-config.repository";
import {
  createMachine,
  createProductionLine,
  createProductionStage,
  createSalesAgent,
} from "@/modules/production-config/production-config.service";
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
  /**
   * Validate-only same-file lookahead for the small set of self-referencing-
   * parent imports (Chart of Account/parentAccount, Category/parentCategory,
   * Employee/reportsTo) — since dry-run never writes anything, a child row's
   * DB lookup for a parent created by an earlier row in the SAME file would
   * otherwise report a false "not found" at Validate time even though Commit
   * (which processes rows sequentially and really writes each one) would
   * genuinely succeed. Populated only by validateBulkImportRows, keyed by a
   * resource tag (e.g. "categories"), each row registering its own
   * lowercased code/name here immediately after passing its own duplicate
   * check — i.e., only once dry-run has confirmed this row really would
   * create a new record. registerDryRunCandidate/hasDryRunCandidate below
   * are the only things that touch this map.
   */
  dryRunRegistry?: Map<string, Set<string>>;
}

type BulkImportRowHandler = (actor: BulkImportActorContext, raw: Record<string, string>, ctx: RowContext) => Promise<BulkImportRowResult>;

const DRY_RUN_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

/** Registers this row's own identifiers as "will exist once this batch commits" — see RowContext.dryRunRegistry's own doc comment. No-op outside dry-run (or when the registry wasn't supplied). */
function registerDryRunCandidate(ctx: RowContext, tag: string, ...values: (string | undefined)[]): void {
  if (!ctx.dryRun || !ctx.dryRunRegistry) return;
  let set = ctx.dryRunRegistry.get(tag);
  if (!set) {
    set = new Set();
    ctx.dryRunRegistry.set(tag, set);
  }
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) set.add(trimmed.toLowerCase());
  }
}

/** Fallback check for a self-referencing parent reference the real DB lookup missed — see RowContext.dryRunRegistry's own doc comment. */
function hasDryRunCandidate(ctx: RowContext, tag: string, text: string): boolean {
  return ctx.dryRunRegistry?.get(tag)?.has(text.trim().toLowerCase()) ?? false;
}

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
  // Supports a parentAccount column referencing an already-existing account
  // by code or name — including one created by an earlier row in the SAME
  // file, since commit processing awaits each row in sequence AND (now)
  // Validate/dry-run mode gets the same same-file lookahead via
  // dryRunRegistry — see RowContext's own doc comment.
  const parentAccountId = await resolveCategoryCompanyScopedId(
    actor.companyId,
    raw.parentAccount,
    (w) => prisma.chartOfAccount.findFirst({ where: w }),
    "Parent account",
    { ctx, tag: "chart_of_accounts" }
  );

  const input = chartOfAccountSchema.parse({
    code: raw.code?.trim(),
    name: raw.name?.trim(),
    accountType: undefinedIfBlank(raw.accountType)?.toUpperCase(),
    parentAccountId: parentAccountId ?? "",
  });

  if (ctx.dryRun) {
    const existing = await ChartOfAccountRepository.findByCode(actor.companyId, input.code);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Account code "${input.code}" is already in use.`);
    registerDryRunCandidate(ctx, "chart_of_accounts", input.code, input.name);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "chart_of_accounts" };
  }

  const account = await createChartOfAccount(actor, input);
  return { recordId: account.id, tableName: "chart_of_accounts" };
}

// ---------------------------------------------------------------------------
// Tier 1 + Tier 2 masters (2026-09-05) — small lookup masters previously only
// reachable one row at a time via SimpleLookupManager. Warehouse+
// WarehouseLocation and Employee are deliberately NOT covered here (see
// BULK_IMPORT_MASTER_TYPES' own comment).
// ---------------------------------------------------------------------------

function parseBooleanCell(raw: string | undefined, defaultValue: boolean): boolean {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return defaultValue;
  return trimmed === "true" || trimmed === "1" || trimmed === "yes";
}

/** Global (not company-scoped) lookup by code-or-name — UnitOfMeasure has no
 * companyId column at all (see lookup.schema.ts's own comment), so this is
 * a separate helper from resolveOptionalId below rather than a variant of it. */
async function resolveUnitIdByCodeOrName(text: string | undefined, label = "Unit"): Promise<string | undefined> {
  const trimmed = undefinedIfBlank(text);
  if (!trimmed) return undefined;
  const byCode = await LookupRepository.unit.findFirst({ where: { code: trimmed } });
  if (byCode) return byCode.id;
  const byName = await LookupRepository.unit.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
  if (byName) return byName.id;
  throw new BusinessRuleError("NOT_FOUND", `${label} "${trimmed}" not found.`);
}

/**
 * Covers every plain {code, name, isActive} lookup master (Brand, Season,
 * Product Fitting, Product Type, Design, Design Pattern, Pattern, Supplier
 * Category, Fabric GSM, Fabric Dye Type, Fabric Weave Type, Fabric
 * Composition, Employee Category) — one factory rather than 13 near-
 * identical handlers, mirroring garment-attributes.service.ts's own
 * makeSimpleLookupService factory for exactly the same reason. Every new row
 * is created active (isActive: true) — there is no "existing record" for an
 * import row to preserve a prior value from.
 */
function makeSimpleCodeNameHandler(
  createFn: (actor: BulkImportActorContext, input: { code: string; name: string; isActive: boolean }) => Promise<{ id: string }>,
  findByCode: (companyId: string, code: string) => Promise<{ id: string } | null>,
  tableName: string
): BulkImportRowHandler {
  return async (actor, raw, ctx) => {
    const code = raw.code?.trim();
    const name = raw.name?.trim();
    if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
    if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");

    if (ctx.dryRun) {
      const existing = await findByCode(actor.companyId, code);
      if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Code "${code}" is already in use.`);
      return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName };
    }

    const record = await createFn(actor, { code, name, isActive: true });
    return { recordId: record.id, tableName };
  };
}

const importColorRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");

  if (ctx.dryRun) {
    const existing = await LookupRepository.color.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Color code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "colors" };
  }

  const color = await createColor(actor, { code, name, hexValue: raw.hexValue?.trim() ?? "", isActive: true });
  return { recordId: color.id, tableName: "colors" };
};

const importSizeRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const sortOrder = raw.sortOrder ? Number(raw.sortOrder) : 0;
  if (!Number.isFinite(sortOrder)) throw new BusinessRuleError("VALIDATION_ERROR", "Sort Order must be a number.");

  if (ctx.dryRun) {
    const existing = await LookupRepository.size.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Size code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "sizes" };
  }

  const size = await createSize(actor, { code, name, sortOrder, isActive: true });
  return { recordId: size.id, tableName: "sizes" };
};

const importUnitRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const conversionFactor = raw.conversionFactor ? Number(raw.conversionFactor) : 1;
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Conversion Factor must be a positive number.");
  }
  const baseUnitId = await resolveUnitIdByCodeOrName(raw.baseUnit, "Base Unit");

  if (ctx.dryRun) {
    // Unit is global, not company-scoped — code uniqueness is checked
    // company-wide, matching createUnit's own findUnique({where:{code}}).
    const existing = await LookupRepository.unit.findFirst({ where: { code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Unit code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "units_of_measure" };
  }

  const unit = await createUnit(actor, { code, name, conversionFactor, baseUnitId: baseUnitId ?? "", isActive: true });
  return { recordId: unit.id, tableName: "units_of_measure" };
};

async function resolveCategoryCompanyScopedId(
  companyId: string,
  text: string | undefined,
  find: (where: Record<string, unknown>) => Promise<{ id: string } | null>,
  label: string,
  /** Only passed by the self-referencing-parent callers (Category/Chart of
   * Account) — see RowContext.dryRunRegistry's own doc comment. Every other
   * caller of this function resolves against a different, already-existing
   * master, so a same-file lookahead would never be meaningful there. */
  dryRunFallback?: { ctx: RowContext; tag: string }
): Promise<string | undefined> {
  const trimmed = undefinedIfBlank(text);
  if (!trimmed) return undefined;
  const byCode = await find({ companyId, code: trimmed });
  if (byCode) return byCode.id;
  const byName = await find({ companyId, name: { equals: trimmed, mode: "insensitive" } });
  if (byName) return byName.id;
  if (dryRunFallback && hasDryRunCandidate(dryRunFallback.ctx, dryRunFallback.tag, trimmed)) {
    return DRY_RUN_PLACEHOLDER_ID;
  }
  throw new BusinessRuleError("NOT_FOUND", `${label} "${trimmed}" not found.`);
}

/**
 * Supports a parentCategory column referencing an already-existing category
 * by code or name — including one created by an earlier row in the SAME
 * file, since commit processing (processBulkImportJob) awaits each row in
 * sequence AND (now) Validate/dry-run mode gets the same same-file lookahead
 * via dryRunRegistry — see RowContext's own doc comment.
 */
const importCategoryRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const parentCategoryId = await resolveCategoryCompanyScopedId(
    actor.companyId,
    raw.parentCategory,
    (w) => GarmentAttributeRepository.category.findFirst({ where: w }),
    "Parent category",
    { ctx, tag: "categories" }
  );

  if (ctx.dryRun) {
    const existing = await GarmentAttributeRepository.category.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Category code "${code}" is already in use.`);
    registerDryRunCandidate(ctx, "categories", code, name);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "categories" };
  }

  const category = await createCategory(actor, { code, name, isActive: true, parentCategoryId: parentCategoryId ?? "" });
  return { recordId: category.id, tableName: "categories" };
};

const importFabricDyeRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const dyeTypeId = await resolveCategoryCompanyScopedId(
    actor.companyId,
    raw.dyeType,
    (w) => FabricConfigRepository.dyeType.findFirst({ where: w }),
    "Dye type"
  );

  if (ctx.dryRun) {
    const existing = await FabricConfigRepository.dye.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Dye code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "fabric_dyes" };
  }

  const dye = await createFabricDye(actor, { code, name, pantone: raw.pantone?.trim() ?? "", dyeTypeId: dyeTypeId ?? "", isActive: true });
  return { recordId: dye.id, tableName: "fabric_dyes" };
};

const importFabricWidthRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const unitId = await resolveUnitIdByCodeOrName(raw.unit);

  if (ctx.dryRun) {
    const existing = await FabricConfigRepository.width.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Width code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "fabric_widths" };
  }

  const width = await createFabricWidth(actor, { code, name, unitId: unitId ?? "", isActive: true });
  return { recordId: width.id, tableName: "fabric_widths" };
};

const importEmployeeCategoryRow = makeSimpleCodeNameHandler(
  (actor, input) => createEmployeeCategory(actor, { ...input, isActive: input.isActive }),
  (companyId, code) => HrConfigRepository.employeeCategory.findFirst({ where: { companyId, code } }),
  "employee_categories"
);

const importDesignationRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const departmentId = await resolveCategoryCompanyScopedId(
    actor.companyId,
    raw.department,
    (w) => DepartmentRepository.findFirst({ where: w }),
    "Department"
  );

  if (ctx.dryRun) {
    const existing = await HrConfigRepository.designation.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Designation code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "designations" };
  }

  const designation = await createDesignation(actor, { code, name, departmentId: departmentId ?? "", isActive: true });
  return { recordId: designation.id, tableName: "designations" };
};

const importShiftMasterRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  const startTime = raw.startTime?.trim();
  const endTime = raw.endTime?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  if (!startTime) throw new BusinessRuleError("VALIDATION_ERROR", "Start Time is required.");
  if (!endTime) throw new BusinessRuleError("VALIDATION_ERROR", "End Time is required.");
  const graceMinutes = raw.graceMinutes ? Number(raw.graceMinutes) : 0;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Grace Minutes must be a non-negative number.");
  }

  if (ctx.dryRun) {
    const existing = await HrConfigRepository.shiftMaster.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Shift code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "shift_masters" };
  }

  const shift = await createShiftMaster(actor, { code, name, startTime, endTime, graceMinutes, isActive: true });
  return { recordId: shift.id, tableName: "shift_masters" };
};

const importHolidayMasterRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const name = raw.name?.trim();
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Holiday Name is required.");
  const date = raw.date?.trim();
  if (!date) throw new BusinessRuleError("VALIDATION_ERROR", "Date is required.");
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) throw new BusinessRuleError("VALIDATION_ERROR", "Date must be a valid date (YYYY-MM-DD).");

  if (ctx.dryRun) {
    const existing = await HrConfigRepository.holidayMaster.findFirst({ where: { companyId: actor.companyId, name, date: parsedDate } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Holiday "${name}" on this date already exists.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "holiday_masters" };
  }

  const holiday = await createHolidayMaster(actor, { name, date: parsedDate, isActive: true });
  return { recordId: holiday.id, tableName: "holiday_masters" };
};

const importCostMasterRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const type = (undefinedIfBlank(raw.type)?.toUpperCase() ?? "HOURLY") as "HOURLY" | "MONTHLY" | "PER_UNIT" | "FIXED" | "PERCENTAGE";
  if (!["HOURLY", "MONTHLY", "PER_UNIT", "FIXED", "PERCENTAGE"].includes(type)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Type "${type}" is not a valid cost master type.`);
  }
  const rate = Number(raw.rate);
  if (!Number.isFinite(rate) || rate < 0) throw new BusinessRuleError("VALIDATION_ERROR", "Rate must be a non-negative number.");

  if (ctx.dryRun) {
    const existing = await CostMasterRepository.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Cost master code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "cost_masters" };
  }

  const costMaster = await createCostMaster(actor, { code, name, type, rate, isActive: true });
  return { recordId: costMaster.id, tableName: "cost_masters" };
};

const importPaymentTypeRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const type = (undefinedIfBlank(raw.type)?.toUpperCase() ?? "CASH") as "CASH" | "BANK" | "CHEQUE" | "CARD" | "UPI" | "OTHER";
  if (!["CASH", "BANK", "CHEQUE", "CARD", "UPI", "OTHER"].includes(type)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Type "${type}" is not a valid payment type.`);
  }

  if (ctx.dryRun) {
    const existing = await FinanceConfigRepository.paymentType.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Payment type code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "payment_types" };
  }

  const paymentType = await createPaymentType(actor, { code, name, type, isActive: true });
  return { recordId: paymentType.id, tableName: "payment_types" };
};

const importBankAccountRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  const bankName = raw.bankName?.trim();
  const accountNumber = raw.accountNumber?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  if (!bankName) throw new BusinessRuleError("VALIDATION_ERROR", "Bank Name is required.");
  if (!accountNumber) throw new BusinessRuleError("VALIDATION_ERROR", "Account Number is required.");

  if (ctx.dryRun) {
    const existing = await FinanceConfigRepository.bankAccount.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Bank account code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "bank_accounts" };
  }

  const bankAccount = await createBankAccount(actor, {
    code,
    name,
    accountKind: "CURRENT",
    bankName,
    accountNumber,
    ifscCode: raw.ifscCode?.trim() ?? "",
    branch: raw.branch?.trim() ?? "",
    accountHolderName: raw.accountHolderName?.trim() ?? "",
    upiId: raw.upiId?.trim() ?? "",
    isActive: true,
  });
  return { recordId: bankAccount.id, tableName: "bank_accounts" };
};

const importDepartmentRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");

  if (ctx.dryRun) {
    const existing = await DepartmentRepository.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Department code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "departments" };
  }

  const department = await createDepartment(actor, { code, name });
  return { recordId: department.id, tableName: "departments" };
};

const importProductionStageRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const sequence = raw.sequence ? Number(raw.sequence) : 0;
  if (!Number.isFinite(sequence)) throw new BusinessRuleError("VALIDATION_ERROR", "Sequence must be a number.");
  const isFinal = parseBooleanCell(raw.isFinal, false);
  const allowRework = parseBooleanCell(raw.allowRework, true);
  const allowsExtraQuantity = parseBooleanCell(raw.allowsExtraQuantity, false);

  if (ctx.dryRun) {
    const existing = await ProductionConfigRepository.stage.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Stage code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "production_stages" };
  }

  const stage = await createProductionStage(actor, { code, name, sequence, isActive: true, isFinal, allowRework, allowsExtraQuantity });
  return { recordId: stage.id, tableName: "production_stages" };
};

const importProductionLineRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const capacityPerDay = undefinedIfBlank(raw.capacityPerDay) ? Number(raw.capacityPerDay) : undefined;
  if (capacityPerDay !== undefined && (!Number.isFinite(capacityPerDay) || capacityPerDay < 0)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Capacity Per Day must be a non-negative number.");
  }

  if (ctx.dryRun) {
    const existing = await ProductionConfigRepository.line.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Line code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "production_lines" };
  }

  const line = await createProductionLine(actor, { code, name, capacityPerDay, isActive: true });
  return { recordId: line.id, tableName: "production_lines" };
};

const importMachineRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const productionLineId = await resolveCategoryCompanyScopedId(
    actor.companyId,
    raw.productionLine,
    (w) => ProductionConfigRepository.line.findFirst({ where: w }),
    "Production line"
  );

  if (ctx.dryRun) {
    const existing = await ProductionConfigRepository.machine.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Machine code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "machines" };
  }

  const machine = await createMachine(actor, {
    code,
    name,
    productionLineId: productionLineId ?? "",
    machineType: raw.machineType?.trim() ?? "",
    isActive: true,
  });
  return { recordId: machine.id, tableName: "machines" };
};

const importSalesAgentRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  const commissionPercent = undefinedIfBlank(raw.commissionPercent) ? Number(raw.commissionPercent) : undefined;
  if (commissionPercent !== undefined && (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Commission % must be between 0 and 100.");
  }

  if (ctx.dryRun) {
    const existing = await ProductionConfigRepository.salesAgent.findFirst({ where: { companyId: actor.companyId, code } });
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Agent code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "sales_agents" };
  }

  const agent = await createSalesAgent(actor, {
    code,
    name,
    contactPerson: raw.contactPerson?.trim() ?? "",
    email: raw.email?.trim() ?? "",
    phone: raw.phone?.trim() ?? "",
    commissionPercent,
    isActive: true,
  });
  return { recordId: agent.id, tableName: "sales_agents" };
};

async function resolveMaterialCategory(text: string): Promise<(typeof MATERIAL_CATEGORIES)[number]> {
  const trimmed = text?.trim().toUpperCase();
  if (!trimmed || !MATERIAL_CATEGORIES.includes(trimmed as (typeof MATERIAL_CATEGORIES)[number])) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Category "${text}" is not valid — must be one of: ${MATERIAL_CATEGORIES.join(", ")}.`
    );
  }
  return trimmed as (typeof MATERIAL_CATEGORIES)[number];
}

const importMaterialRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const styleCode = undefinedIfBlank(raw.styleCode) ?? (await previewNextMasterCode(actor.companyId, "MATERIAL"));
  const materialCategory = await resolveMaterialCategory(raw.materialCategory);
  const [baseUomId, defaultSupplierId] = await Promise.all([
    resolveUnitIdByCodeOrName(raw.baseUnit, "Base Unit"),
    resolveOptionalId(actor.companyId, raw.defaultSupplier, (w) => prisma.supplier.findFirst({ where: w }), "Default Supplier"),
  ]);

  const input = materialSchema.parse({
    styleCode,
    styleName: raw.styleName?.trim(),
    materialCategory,
    baseUomId: baseUomId ?? "",
    defaultSupplierId: defaultSupplierId ?? "",
    reorderLevel: raw.reorderLevel,
    unitCost: raw.unitCost,
    hsnSacCode: raw.hsnSacCode?.trim() ?? "",
  });

  if (ctx.dryRun) {
    const existing = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Item code "${input.styleCode}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "products" };
  }

  const material = await createMaterial(actor, input);
  return { recordId: material.id, tableName: "products" };
};

// ---------------------------------------------------------------------------
// Warehouse + Employee (2026-09-05) — the two masters originally deferred
// pending their own design pass (nested parent/child, self-referencing FK
// respectively). Resolved by mirroring patterns already proven above rather
// than inventing new mechanisms: WAREHOUSE/WAREHOUSE_LOCATION is the exact
// PRODUCT/PRODUCT_VARIANT two-tier shape (parent-must-exist-first,
// referenced by code); EMPLOYEE's reportsTo resolves like CATEGORY's own
// self-referencing parent (by code, same-file in-order caveat applies).
// ---------------------------------------------------------------------------

/** warehouse.service.ts's own ActorContext requires branchId: string | null
 * (never undefined) — BulkImportActorContext's is optional, since most
 * handlers never touch it. Narrows once, here, rather than at every call
 * site below. */
function toWarehouseActor(actor: BulkImportActorContext): { companyId: string; userId: string; branchId: string | null } {
  return { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null };
}

const importWarehouseRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const code = raw.code?.trim();
  const name = raw.name?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Code is required.");
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", "Name is required.");
  if (!actor.branchId) throw new BusinessRuleError("VALIDATION_ERROR", "Your account has no default branch assigned.");

  const typeTokens = (raw.type ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (typeTokens.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "At least one Type is required.");
  const invalidTypes = typeTokens.filter((t) => !(WAREHOUSE_TYPES as readonly string[]).includes(t));
  if (invalidTypes.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Type(s) "${invalidTypes.join(", ")}" are not valid — must be one of: ${WAREHOUSE_TYPES.join(", ")}.`
    );
  }

  if (ctx.dryRun) {
    const existing = await WarehouseRepository.findByCodeInBranch(actor.branchId, code);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Warehouse code "${code}" is already in use.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "warehouses" };
  }

  const warehouse = await createWarehouse(toWarehouseActor(actor), {
    code,
    name,
    type: typeTokens as (typeof WAREHOUSE_TYPES)[number][],
    isActive: true,
  });
  return { recordId: warehouse.id, tableName: "warehouses" };
};

const importWarehouseLocationRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  if (!actor.branchId) throw new BusinessRuleError("VALIDATION_ERROR", "Your account has no default branch assigned.");
  const warehouseCode = raw.warehouse?.trim();
  if (!warehouseCode) throw new BusinessRuleError("VALIDATION_ERROR", "Warehouse is required.");
  const warehouse = await WarehouseRepository.findByCodeInBranch(actor.branchId, warehouseCode);
  if (!warehouse) throw new BusinessRuleError("NOT_FOUND", `Warehouse "${warehouseCode}" not found — import Warehouse rows first.`);

  const code = raw.code?.trim();
  if (!code) throw new BusinessRuleError("VALIDATION_ERROR", "Location Code is required.");

  const materialCategory = undefinedIfBlank(raw.materialCategory)?.toUpperCase();
  if (materialCategory && !(LOCATION_MATERIAL_CATEGORIES as readonly string[]).includes(materialCategory)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Category "${materialCategory}" is not valid — must be one of: ${LOCATION_MATERIAL_CATEGORIES.join(", ")}.`
    );
  }

  if (ctx.dryRun) {
    const existingLoc = await WarehouseLocationRepository.findByCode(warehouse.id, code);
    if (existingLoc) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Location code "${code}" already exists in this warehouse.`);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "warehouse_locations" };
  }

  const location = await createWarehouseLocation(toWarehouseActor(actor), warehouse.id, {
    code,
    zone: raw.zone?.trim() ?? "",
    rack: raw.rack?.trim() ?? "",
    bin: raw.bin?.trim() ?? "",
    materialCategory: (materialCategory ?? "") as (typeof LOCATION_MATERIAL_CATEGORIES)[number] | "",
    materialCategoryOther: "",
  });
  return { recordId: location.id, tableName: "warehouse_locations" };
};

const importEmployeeRow: BulkImportRowHandler = async (actor, raw, ctx) => {
  const fullName = raw.fullName?.trim();
  if (!fullName) throw new BusinessRuleError("VALIDATION_ERROR", "Full Name is required.");
  const employeeCode = undefinedIfBlank(raw.employeeCode) ?? (await previewNextMasterCode(actor.companyId, "EMPLOYEE"));

  const [departmentId, designationId, employeeCategoryId, shiftId] = await Promise.all([
    resolveCategoryCompanyScopedId(actor.companyId, raw.department, (w) => DepartmentRepository.findFirst({ where: w }), "Department"),
    resolveCategoryCompanyScopedId(actor.companyId, raw.designation, (w) => HrConfigRepository.designation.findFirst({ where: w }), "Designation"),
    resolveCategoryCompanyScopedId(
      actor.companyId,
      raw.employeeCategory,
      (w) => HrConfigRepository.employeeCategory.findFirst({ where: w }),
      "Employee category"
    ),
    resolveCategoryCompanyScopedId(actor.companyId, raw.shift, (w) => HrConfigRepository.shiftMaster.findFirst({ where: w }), "Shift"),
  ]);

  const reportsToCode = undefinedIfBlank(raw.reportsTo);
  let reportsToId: string | undefined;
  if (reportsToCode) {
    // Company-wide by employee code — not company+deletedAt-scoped through
    // resolveCategoryCompanyScopedId's generic {code|name} shape, since a
    // manager lookup only ever makes sense by the human-facing employee
    // code, never by (possibly non-unique) full name.
    const manager = await EmployeeRepository.findByCode(actor.companyId, reportsToCode);
    if (manager) {
      reportsToId = manager.id;
    } else if (hasDryRunCandidate(ctx, "employees", reportsToCode)) {
      // Same-file lookahead — see RowContext.dryRunRegistry's own doc
      // comment. Only reachable during Validate; never used for real (a
      // real commit's DB lookup above would already have found the manager
      // row an earlier row in this same batch just created).
      reportsToId = DRY_RUN_PLACEHOLDER_ID;
    } else {
      throw new BusinessRuleError("NOT_FOUND", `Reporting manager "${reportsToCode}" not found — import their row first.`);
    }
  }

  if (ctx.dryRun) {
    const existing = await EmployeeRepository.findByCode(actor.companyId, employeeCode);
    if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Employee code "${employeeCode}" is already in use.`);
    registerDryRunCandidate(ctx, "employees", employeeCode);
    return { recordId: DRY_RUN_PLACEHOLDER_ID, tableName: "employees" };
  }

  const employee = await createEmployee(actor, {
    employeeCode,
    fullName,
    departmentId: departmentId ?? "",
    designationId: designationId ?? "",
    employeeCategoryId: employeeCategoryId ?? "",
    shiftId: shiftId ?? "",
    reportsToId: reportsToId ?? "",
    phone: raw.phone?.trim() ?? "",
    email: raw.email?.trim() ?? "",
    joinDate: raw.joinDate?.trim() ?? "",
    isActive: true,
  });
  return { recordId: employee.id, tableName: "employees" };
};

const BULK_IMPORTERS: Record<BulkImportMasterType, BulkImportRowHandler> = {
  CUSTOMER: importCustomerRow,
  SUPPLIER: importSupplierRow,
  PRODUCT: importProductRow,
  PRODUCT_VARIANT: importProductVariantRow,
  OPENING_STOCK: importOpeningStockRowHandler,
  CHART_OF_ACCOUNT: importChartOfAccountRow,

  COLOR: importColorRow,
  SIZE: importSizeRow,
  UNIT: importUnitRow,
  BRAND: makeSimpleCodeNameHandler(createBrand, (companyId, code) => GarmentAttributeRepository.brand.findFirst({ where: { companyId, code } }), "brands"),
  SEASON: makeSimpleCodeNameHandler(createSeason, (companyId, code) => GarmentAttributeRepository.season.findFirst({ where: { companyId, code } }), "seasons"),
  PRODUCT_FITTING: makeSimpleCodeNameHandler(
    createProductFitting,
    (companyId, code) => GarmentAttributeRepository.productFitting.findFirst({ where: { companyId, code } }),
    "product_fittings"
  ),
  PRODUCT_TYPE: makeSimpleCodeNameHandler(
    createProductType,
    (companyId, code) => GarmentAttributeRepository.productType.findFirst({ where: { companyId, code } }),
    "product_types"
  ),
  DESIGN: makeSimpleCodeNameHandler(createDesign, (companyId, code) => GarmentAttributeRepository.design.findFirst({ where: { companyId, code } }), "designs"),
  DESIGN_PATTERN: makeSimpleCodeNameHandler(
    createDesignPattern,
    (companyId, code) => GarmentAttributeRepository.designPattern.findFirst({ where: { companyId, code } }),
    "design_patterns"
  ),
  PATTERN: makeSimpleCodeNameHandler(createPattern, (companyId, code) => GarmentAttributeRepository.pattern.findFirst({ where: { companyId, code } }), "patterns"),
  SUPPLIER_CATEGORY: makeSimpleCodeNameHandler(
    createSupplierCategory,
    (companyId, code) => GarmentAttributeRepository.supplierCategory.findFirst({ where: { companyId, code } }),
    "supplier_categories"
  ),
  FABRIC_GSM: makeSimpleCodeNameHandler(createFabricGsm, (companyId, code) => FabricConfigRepository.gsm.findFirst({ where: { companyId, code } }), "fabric_gsms"),
  FABRIC_DYE_TYPE: makeSimpleCodeNameHandler(
    createFabricDyeType,
    (companyId, code) => FabricConfigRepository.dyeType.findFirst({ where: { companyId, code } }),
    "fabric_dye_types"
  ),
  FABRIC_WEAVE_TYPE: makeSimpleCodeNameHandler(
    createFabricWeaveType,
    (companyId, code) => FabricConfigRepository.weaveType.findFirst({ where: { companyId, code } }),
    "fabric_weave_types"
  ),
  FABRIC_COMPOSITION: makeSimpleCodeNameHandler(
    createFabricComposition,
    (companyId, code) => FabricConfigRepository.composition.findFirst({ where: { companyId, code } }),
    "fabric_compositions"
  ),
  EMPLOYEE_CATEGORY: importEmployeeCategoryRow,
  COST_MASTER: importCostMasterRow,
  PAYMENT_TYPE: importPaymentTypeRow,
  DEPARTMENT: importDepartmentRow,
  CATEGORY: importCategoryRow,
  FABRIC_DYE: importFabricDyeRow,
  FABRIC_WIDTH: importFabricWidthRow,
  DESIGNATION: importDesignationRow,
  SHIFT_MASTER: importShiftMasterRow,
  HOLIDAY_MASTER: importHolidayMasterRow,
  PRODUCTION_STAGE: importProductionStageRow,
  PRODUCTION_LINE: importProductionLineRow,
  MACHINE: importMachineRow,
  SALES_AGENT: importSalesAgentRow,
  BANK_ACCOUNT: importBankAccountRow,
  MATERIAL: importMaterialRow,
  WAREHOUSE: importWarehouseRow,
  WAREHOUSE_LOCATION: importWarehouseLocationRow,
  EMPLOYEE: importEmployeeRow,
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
 * normalize-and-compare (case/punctuation-insensitive), so
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
  // One registry per validation pass, threaded through every row so a
  // self-referencing-parent row (Chart of Account/Category/Employee) can see
  // what an earlier row in this SAME file would create — see RowContext's
  // own doc comment.
  const dryRunRegistry = new Map<string, Set<string>>();

  for (let i = 0; i < rows.length; i++) {
    try {
      await importRow(actor, rows[i], { importBatchId: DRY_RUN_PLACEHOLDER_ID, dryRun: true, dryRunRegistry });
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
 * called from an API route. Per-row isolation: a bad row is reported, not
 * fatal to the whole batch.
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

/**
 * Generic Undo path for the plain {isActive} lookup masters added 2026-09-05
 * — bypasses each master's own full update() (which expects a complete
 * code/name/etc payload) and flips isActive directly via the repository
 * delegate, audit-logged the same way. Safe for Undo specifically: the batch
 * this runs against is already scoped to the acting company via
 * ImportBatchRepository.findByIdWithDetails's own companyId filter, so this
 * doesn't need its own separate ownership re-check the way a public
 * edit-by-id endpoint would.
 */
function makeGenericDeactivate(
  delegate: { update: (args: { where: { id: string }; data: { isActive: boolean } }) => Promise<{ id: string }> },
  tableName: string
) {
  return async (actor: BulkImportActorContext, id: string) => {
    const updated = await delegate.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName, recordId: id, action: "UPDATE", newValues: { isActive: false } });
    return updated;
  };
}

const DEACTIVATE_BY_TABLE: Record<string, (actor: BulkImportActorContext, id: string) => Promise<unknown>> = {
  customers: (actor, id) => deactivateCustomer(actor, id),
  suppliers: (actor, id) => deactivateSupplier(actor, id),
  products: (actor, id) => setProductActiveStatus(actor, id, false),
  product_variants: (actor, id) => setProductVariantActiveStatus(actor, id, false),
  chart_of_accounts: (actor, id) => setChartOfAccountActiveStatus(actor, id, false),

  colors: makeGenericDeactivate(LookupRepository.color, "colors"),
  sizes: makeGenericDeactivate(LookupRepository.size, "sizes"),
  units_of_measure: makeGenericDeactivate(LookupRepository.unit, "units_of_measure"),
  brands: makeGenericDeactivate(GarmentAttributeRepository.brand, "brands"),
  categories: makeGenericDeactivate(GarmentAttributeRepository.category, "categories"),
  seasons: makeGenericDeactivate(GarmentAttributeRepository.season, "seasons"),
  product_fittings: makeGenericDeactivate(GarmentAttributeRepository.productFitting, "product_fittings"),
  product_types: makeGenericDeactivate(GarmentAttributeRepository.productType, "product_types"),
  designs: makeGenericDeactivate(GarmentAttributeRepository.design, "designs"),
  design_patterns: makeGenericDeactivate(GarmentAttributeRepository.designPattern, "design_patterns"),
  patterns: makeGenericDeactivate(GarmentAttributeRepository.pattern, "patterns"),
  supplier_categories: makeGenericDeactivate(GarmentAttributeRepository.supplierCategory, "supplier_categories"),
  fabric_gsms: makeGenericDeactivate(FabricConfigRepository.gsm, "fabric_gsms"),
  fabric_dye_types: makeGenericDeactivate(FabricConfigRepository.dyeType, "fabric_dye_types"),
  fabric_weave_types: makeGenericDeactivate(FabricConfigRepository.weaveType, "fabric_weave_types"),
  fabric_compositions: makeGenericDeactivate(FabricConfigRepository.composition, "fabric_compositions"),
  fabric_dyes: makeGenericDeactivate(FabricConfigRepository.dye, "fabric_dyes"),
  fabric_widths: makeGenericDeactivate(FabricConfigRepository.width, "fabric_widths"),
  employee_categories: makeGenericDeactivate(HrConfigRepository.employeeCategory, "employee_categories"),
  designations: makeGenericDeactivate(HrConfigRepository.designation, "designations"),
  shift_masters: makeGenericDeactivate(HrConfigRepository.shiftMaster, "shift_masters"),
  holiday_masters: makeGenericDeactivate(HrConfigRepository.holidayMaster, "holiday_masters"),
  cost_masters: makeGenericDeactivate(CostMasterRepository, "cost_masters"),
  payment_types: makeGenericDeactivate(FinanceConfigRepository.paymentType, "payment_types"),
  bank_accounts: makeGenericDeactivate(FinanceConfigRepository.bankAccount, "bank_accounts"),
  production_stages: makeGenericDeactivate(ProductionConfigRepository.stage, "production_stages"),
  production_lines: makeGenericDeactivate(ProductionConfigRepository.line, "production_lines"),
  machines: makeGenericDeactivate(ProductionConfigRepository.machine, "machines"),
  sales_agents: makeGenericDeactivate(ProductionConfigRepository.salesAgent, "sales_agents"),
  warehouses: (actor, id) => setWarehouseActiveStatus(toWarehouseActor(actor), id, false),
  // Needs its parent warehouseId first — setWarehouseLocationActiveStatus is
  // nested under a warehouse route in the manual UI, unlike every other
  // generic deactivate above.
  warehouse_locations: async (actor, id) => {
    const location = await WarehouseLocationRepository.findByIdWithWarehouse(id);
    if (!location) return null;
    return setWarehouseLocationActiveStatus(toWarehouseActor(actor), location.warehouseId, id, false);
  },
  employees: (actor, id) => deactivateEmployee(actor, id),
  // departments has no isActive column at all — no Undo path, matching the
  // existing "No undo path for this record type" fallback in
  // undoBulkImportBatch below.
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
