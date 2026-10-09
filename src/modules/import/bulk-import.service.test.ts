import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

vi.mock("@/core/db/client", () => ({
  prisma: {
    product: { findFirst: vi.fn() },
    color: { findFirst: vi.fn() },
    size: { findFirst: vi.fn() },
    productVariant: { findUnique: vi.fn() },
    warehouse: { findFirst: vi.fn() },
    supplier: { findFirst: vi.fn() },
    chartOfAccount: { findFirst: vi.fn() },
  },
}));

vi.mock("@/core/file-storage/FileStorage", () => ({ saveFile: vi.fn() }));

vi.mock("@/core/numbering/DocumentNumberingService", () => ({ previewNextMasterCode: vi.fn() }));

vi.mock("@/core/jobs/queue", () => ({ getBulkImportQueue: vi.fn() }));

vi.mock("@/modules/customers/customer.service", () => ({ createCustomer: vi.fn(), deactivateCustomer: vi.fn() }));
vi.mock("@/modules/customers/customer.repository", () => ({ CustomerRepository: { findByCode: vi.fn() } }));
vi.mock("@/modules/suppliers/supplier.service", () => ({ createSupplier: vi.fn(), deactivateSupplier: vi.fn() }));
vi.mock("@/modules/suppliers/supplier.repository", () => ({ SupplierRepository: { findByCode: vi.fn() } }));
vi.mock("@/modules/products/product.service", () => ({
  createProduct: vi.fn(),
  createProductVariantExplicit: vi.fn(),
  setProductActiveStatus: vi.fn(),
  setProductVariantActiveStatus: vi.fn(),
  createMaterial: vi.fn(),
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findByStyleCode: vi.fn() },
  ProductVariantRepository: { findBySkuCode: vi.fn(), findByProductColorSize: vi.fn() },
}));
vi.mock("@/modules/accounts/chart-of-account.service", () => ({ createChartOfAccount: vi.fn(), setChartOfAccountActiveStatus: vi.fn() }));
vi.mock("@/modules/accounts/chart-of-account.repository", () => ({ ChartOfAccountRepository: { findByCode: vi.fn() } }));
vi.mock("@/modules/inventory/inventory.service", () => ({ importOpeningStockRow: vi.fn() }));
vi.mock("@/modules/garment-attributes/garment-attributes.repository", () => ({
  GarmentAttributeRepository: {
    supplierCategory: { findFirst: vi.fn() },
    category: { findFirst: vi.fn(), update: vi.fn() },
    season: { findFirst: vi.fn() },
    brand: { findFirst: vi.fn(), update: vi.fn() },
    productFitting: { findFirst: vi.fn() },
    productType: { findFirst: vi.fn() },
    design: { findFirst: vi.fn() },
    designPattern: { findFirst: vi.fn() },
    pattern: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/garment-attributes/garment-attributes.service", () => ({
  createBrand: vi.fn(),
  createCategory: vi.fn(),
  createSeason: vi.fn(),
  createProductFitting: vi.fn(),
  createProductType: vi.fn(),
  createDesign: vi.fn(),
  createDesignPattern: vi.fn(),
  createPattern: vi.fn(),
  createSupplierCategory: vi.fn(),
}));
vi.mock("@/modules/fabric-config/fabric-config.repository", () => ({
  FabricConfigRepository: {
    gsm: { findFirst: vi.fn() },
    dye: { findFirst: vi.fn() },
    dyeType: { findFirst: vi.fn() },
    weaveType: { findFirst: vi.fn() },
    width: { findFirst: vi.fn() },
    composition: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/fabric-config/fabric-config.service", () => ({
  createFabricGsm: vi.fn(),
  createFabricDye: vi.fn(),
  createFabricDyeType: vi.fn(),
  createFabricWeaveType: vi.fn(),
  createFabricWidth: vi.fn(),
  createFabricComposition: vi.fn(),
}));
vi.mock("@/modules/hr-config/hr-config.repository", () => ({
  HrConfigRepository: {
    designation: { findFirst: vi.fn() },
    employeeCategory: { findFirst: vi.fn() },
    shiftMaster: { findFirst: vi.fn() },
    holidayMaster: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/hr-config/hr-config.service", () => ({
  createDesignation: vi.fn(),
  createEmployeeCategory: vi.fn(),
  createShiftMaster: vi.fn(),
  createHolidayMaster: vi.fn(),
}));
vi.mock("@/modules/cost-master/cost-master.repository", () => ({ CostMasterRepository: { findFirst: vi.fn() } }));
vi.mock("@/modules/cost-master/cost-master.service", () => ({ createCostMaster: vi.fn() }));
vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: { paymentType: { findFirst: vi.fn() }, bankAccount: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/finance-config/finance-config.service", () => ({ createPaymentType: vi.fn(), createBankAccount: vi.fn() }));
vi.mock("@/modules/departments/department.repository", () => ({ DepartmentRepository: { findFirst: vi.fn() } }));
vi.mock("@/modules/departments/department.service", () => ({ createDepartment: vi.fn() }));
vi.mock("@/modules/production-config/production-config.repository", () => ({
  ProductionConfigRepository: {
    stage: { findFirst: vi.fn() },
    line: { findFirst: vi.fn() },
    machine: { findFirst: vi.fn() },
    salesAgent: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/production-config/production-config.service", () => ({
  createProductionStage: vi.fn(),
  createProductionLine: vi.fn(),
  createMachine: vi.fn(),
  createSalesAgent: vi.fn(),
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { color: { findFirst: vi.fn() }, size: { findFirst: vi.fn() }, unit: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/lookups/lookup.service", () => ({ createColor: vi.fn(), createSize: vi.fn(), createUnit: vi.fn() }));
vi.mock("@/modules/warehouses/warehouse.repository", () => ({
  WarehouseRepository: { findByCodeInBranch: vi.fn() },
  WarehouseLocationRepository: { findByCode: vi.fn(), findByIdWithWarehouse: vi.fn() },
}));
vi.mock("@/modules/warehouses/warehouse.service", () => ({
  createWarehouse: vi.fn(),
  createWarehouseLocation: vi.fn(),
  setWarehouseActiveStatus: vi.fn(),
  setWarehouseLocationActiveStatus: vi.fn(),
}));
vi.mock("@/modules/employees/employee.repository", () => ({ EmployeeRepository: { findByCode: vi.fn() } }));
vi.mock("@/modules/employees/employee.service", () => ({ createEmployee: vi.fn(), deactivateEmployee: vi.fn() }));

// A trimmed, real re-implementation (not a mock of behavior) so the two
// helpers this file genuinely reuses from import.service.ts behave
// identically here without pulling in that file's own real imports.
vi.mock("./import.service", () => ({
  undefinedIfBlank: (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  },
  messageFromError: (error: unknown) => {
    if (error instanceof BusinessRuleError) return error.message;
    if (error instanceof Error) return error.message;
    return "Import failed for this row.";
  },
}));

vi.mock("./import.repository", () => ({
  ImportBatchRepository: {
    createQueued: vi.fn(),
    setJobId: vi.fn(),
    setStatus: vi.fn(),
    finalize: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findRecordsForBatch: vi.fn(),
    addRecord: vi.fn(),
  },
}));

const { prisma } = await import("@/core/db/client");
const { saveFile } = await import("@/core/file-storage/FileStorage");
const { previewNextMasterCode } = await import("@/core/numbering/DocumentNumberingService");
const { getBulkImportQueue } = await import("@/core/jobs/queue");
const { createCustomer, deactivateCustomer } = await import("@/modules/customers/customer.service");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { createSupplier, deactivateSupplier } = await import("@/modules/suppliers/supplier.service");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { createProduct, createProductVariantExplicit, setProductActiveStatus, setProductVariantActiveStatus } = await import(
  "@/modules/products/product.service"
);
const { ProductRepository, ProductVariantRepository } = await import("@/modules/products/product.repository");
const { createChartOfAccount, setChartOfAccountActiveStatus } = await import("@/modules/accounts/chart-of-account.service");
const { ChartOfAccountRepository } = await import("@/modules/accounts/chart-of-account.repository");
const { importOpeningStockRow } = await import("@/modules/inventory/inventory.service");
const { createMaterial } = await import("@/modules/products/product.service");
const { GarmentAttributeRepository } = await import("@/modules/garment-attributes/garment-attributes.repository");
const { createBrand, createCategory } = await import("@/modules/garment-attributes/garment-attributes.service");
const { FabricConfigRepository } = await import("@/modules/fabric-config/fabric-config.repository");
const { HrConfigRepository } = await import("@/modules/hr-config/hr-config.repository");
const { CostMasterRepository } = await import("@/modules/cost-master/cost-master.repository");
const { createCostMaster } = await import("@/modules/cost-master/cost-master.service");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { createPaymentType } = await import("@/modules/finance-config/finance-config.service");
const { DepartmentRepository } = await import("@/modules/departments/department.repository");
const { ProductionConfigRepository } = await import("@/modules/production-config/production-config.repository");
const { createProductionStage } = await import("@/modules/production-config/production-config.service");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { WarehouseRepository, WarehouseLocationRepository } = await import("@/modules/warehouses/warehouse.repository");
const { createWarehouse, createWarehouseLocation } = await import("@/modules/warehouses/warehouse.service");
const { EmployeeRepository } = await import("@/modules/employees/employee.repository");
const { createEmployee } = await import("@/modules/employees/employee.service");
const { ImportBatchRepository } = await import("./import.repository");

const {
  parseUploadedFile,
  resolveUploadedFileMimeType,
  validateBulkImportRows,
  commitBulkImport,
  processBulkImportJob,
  undoBulkImportBatch,
} = await import("./bulk-import.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(prisma.product.findFirst).mockReset();
  vi.mocked(prisma.color.findFirst).mockReset();
  vi.mocked(prisma.size.findFirst).mockReset();
  vi.mocked(prisma.productVariant.findUnique).mockReset();
  vi.mocked(prisma.warehouse.findFirst).mockReset();
  vi.mocked(saveFile).mockReset();
  vi.mocked(previewNextMasterCode).mockReset().mockResolvedValue("CUST-00001" as never);
  vi.mocked(createCustomer).mockReset().mockResolvedValue({ id: "cust-1" } as never);
  vi.mocked(CustomerRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(deactivateCustomer).mockReset();
  vi.mocked(createSupplier).mockReset().mockResolvedValue({ id: "supp-1" } as never);
  vi.mocked(SupplierRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(deactivateSupplier).mockReset();
  vi.mocked(createProduct).mockReset().mockResolvedValue({ id: "prod-1" } as never);
  vi.mocked(ProductRepository.findByStyleCode).mockReset().mockResolvedValue(null);
  vi.mocked(createProductVariantExplicit).mockReset().mockResolvedValue({ id: "variant-1" } as never);
  vi.mocked(ProductVariantRepository.findBySkuCode).mockReset().mockResolvedValue(null);
  vi.mocked(ProductVariantRepository.findByProductColorSize).mockReset().mockResolvedValue(null);
  vi.mocked(setProductActiveStatus).mockReset();
  vi.mocked(setProductVariantActiveStatus).mockReset();
  vi.mocked(createChartOfAccount).mockReset().mockResolvedValue({ id: "coa-1" } as never);
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(setChartOfAccountActiveStatus).mockReset();
  vi.mocked(prisma.chartOfAccount.findFirst).mockReset();
  vi.mocked(importOpeningStockRow).mockReset();
  vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockReset();
  vi.mocked(GarmentAttributeRepository.category.findFirst).mockReset();
  vi.mocked(GarmentAttributeRepository.season.findFirst).mockReset();
  vi.mocked(GarmentAttributeRepository.brand.findFirst).mockReset();
  vi.mocked(createBrand).mockReset().mockResolvedValue({ id: "brand-1" } as never);
  vi.mocked(createCategory).mockReset().mockResolvedValue({ id: "cat-1" } as never);
  vi.mocked(FabricConfigRepository.width.findFirst).mockReset();
  vi.mocked(FabricConfigRepository.dyeType.findFirst).mockReset();
  vi.mocked(HrConfigRepository.designation.findFirst).mockReset();
  vi.mocked(HrConfigRepository.holidayMaster.findFirst).mockReset();
  vi.mocked(DepartmentRepository.findFirst).mockReset();
  vi.mocked(CostMasterRepository.findFirst).mockReset();
  vi.mocked(createCostMaster).mockReset().mockResolvedValue({ id: "cm-1" } as never);
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset();
  vi.mocked(createPaymentType).mockReset().mockResolvedValue({ id: "pt-1" } as never);
  vi.mocked(ProductionConfigRepository.stage.findFirst).mockReset();
  vi.mocked(createProductionStage).mockReset().mockResolvedValue({ id: "stage-1" } as never);
  vi.mocked(LookupRepository.unit.findFirst).mockReset();
  vi.mocked(createMaterial).mockReset().mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(WarehouseRepository.findByCodeInBranch).mockReset();
  vi.mocked(createWarehouse).mockReset().mockResolvedValue({ id: "wh-1" } as never);
  vi.mocked(WarehouseLocationRepository.findByCode).mockReset();
  vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockReset();
  vi.mocked(createWarehouseLocation).mockReset().mockResolvedValue({ id: "loc-1" } as never);
  vi.mocked(EmployeeRepository.findByCode).mockReset();
  vi.mocked(createEmployee).mockReset().mockResolvedValue({ id: "emp-1" } as never);
  vi.mocked(ImportBatchRepository.createQueued)
    .mockReset()
    .mockResolvedValue({ id: "batch-1" } as never);
  vi.mocked(ImportBatchRepository.setJobId).mockReset();
  vi.mocked(ImportBatchRepository.setStatus).mockReset();
  vi.mocked(ImportBatchRepository.finalize).mockReset();
  vi.mocked(ImportBatchRepository.findByIdWithDetails).mockReset();
  vi.mocked(ImportBatchRepository.findRecordsForBatch).mockReset();
  vi.mocked(ImportBatchRepository.addRecord).mockReset();
});

describe("resolveUploadedFileMimeType", () => {
  it("resolves by file extension over the browser-supplied MIME type", () => {
    expect(resolveUploadedFileMimeType("customers.csv", "application/vnd.ms-excel")).toBe("text/csv");
    expect(resolveUploadedFileMimeType("customers.xlsx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });
});

describe("parseUploadedFile — CSV", () => {
  it("auto-maps a header row matching the column labels and returns mapped rows", async () => {
    const csv = "Name,Country\nAcme Apparel,India\n";
    const { rows, totalRows } = await parseUploadedFile(Buffer.from(csv), "text/csv", "CUSTOMER");

    expect(totalRows).toBe(1);
    expect(rows[0]).toMatchObject({ name: "Acme Apparel", country: "India" });
  });

  it("rejects a file missing a required column with a clear message naming it", async () => {
    const csv = "Country\nIndia\n";
    await expect(parseUploadedFile(Buffer.from(csv), "text/csv", "CUSTOMER")).rejects.toThrow(/missing required column/i);
  });

  it("rejects a file with a header row but no data rows", async () => {
    const csv = "Name,Country\n";
    await expect(parseUploadedFile(Buffer.from(csv), "text/csv", "CUSTOMER")).rejects.toThrow(/no data rows/i);
  });
});

describe("importCustomerRow (via validateBulkImportRows)", () => {
  it("auto-generates the code via previewNextMasterCode and checks it for real via CustomerRepository, without ever calling createCustomer", async () => {
    const result = await validateBulkImportRows(actor, "CUSTOMER", [{ name: "Acme Apparel", country: "India" }]);

    expect(previewNextMasterCode).toHaveBeenCalledWith("co-1", "CUSTOMER");
    expect(CustomerRepository.findByCode).toHaveBeenCalledWith("co-1", "CUST-00001");
    expect(result.validCount).toBe(1);
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("reports a real duplicate code (found via the real repository check) as a row error, not a thrown exception", async () => {
    vi.mocked(CustomerRepository.findByCode).mockResolvedValueOnce({ id: "existing-cust" } as never);

    const result = await validateBulkImportRows(actor, "CUSTOMER", [{ code: "CUST-001", name: "Acme Apparel" }]);

    expect(result.validCount).toBe(0);
    expect(result.errors[0].reason).toContain('Customer code "CUST-001" is already in use');
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

const FAKE_UUID = "11111111-1111-4111-8111-111111111111";

describe("importSupplierRow", () => {
  it("resolves Category by code or name, without ever calling createSupplier during validation", async () => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValueOnce({ id: FAKE_UUID } as never);

    const result = await validateBulkImportRows(actor, "SUPPLIER", [{ name: "Om Fabrics", category: "Fabric" }]);

    expect(result.validCount).toBe(1);
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it("fails the row with a clear message when Category doesn't resolve to a real master", async () => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValueOnce(null);

    const result = await validateBulkImportRows(actor, "SUPPLIER", [{ name: "Om Fabrics", category: "Nonexistent" }]);

    expect(result.errors[0].reason).toContain('Supplier category "Nonexistent" not found');
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it("reports a real duplicate supplier code as a row error", async () => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValueOnce({ id: FAKE_UUID } as never);
    vi.mocked(SupplierRepository.findByCode).mockResolvedValueOnce({ id: "existing-supp" } as never);

    const result = await validateBulkImportRows(actor, "SUPPLIER", [{ code: "SUP-001", name: "Om Fabrics", category: "Fabric" }]);

    expect(result.errors[0].reason).toContain('Supplier code "SUP-001" is already in use');
  });
});

describe("importProductVariantRow — dependency-order enforcement", () => {
  it("rejects the row before resolving anything else when the parent style doesn't exist", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValueOnce(null);

    const result = await validateBulkImportRows(actor, "PRODUCT_VARIANT", [
      { styleCode: "ST-99999", color: "Black", size: "M", skuCode: "ST-99999-BLK-M" },
    ]);

    expect(result.errors[0].reason).toContain('Parent style "ST-99999" not found');
    expect(prisma.color.findFirst).not.toHaveBeenCalled();
    expect(createProductVariantExplicit).not.toHaveBeenCalled();
  });

  it("validates successfully once the parent style, color/size, and a unique SKU all resolve — without ever calling createProductVariantExplicit", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValueOnce({ id: "prod-1" } as never);
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1" } as never);
    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce({ id: "size-1" } as never);

    const result = await validateBulkImportRows(actor, "PRODUCT_VARIANT", [
      { styleCode: "ST-00001", color: "Black", size: "M", skuCode: "ST-00001-BLK-M" },
    ]);

    expect(result.validCount).toBe(1);
    expect(ProductVariantRepository.findBySkuCode).toHaveBeenCalledWith("ST-00001-BLK-M");
    expect(createProductVariantExplicit).not.toHaveBeenCalled();
  });

  it("reports a real duplicate SKU as a row error", async () => {
    vi.mocked(prisma.product.findFirst).mockResolvedValueOnce({ id: "prod-1" } as never);
    vi.mocked(prisma.color.findFirst).mockResolvedValueOnce({ id: "color-1" } as never);
    vi.mocked(prisma.size.findFirst).mockResolvedValueOnce({ id: "size-1" } as never);
    vi.mocked(ProductVariantRepository.findBySkuCode).mockResolvedValueOnce({ id: "existing-variant" } as never);

    const result = await validateBulkImportRows(actor, "PRODUCT_VARIANT", [
      { styleCode: "ST-00001", color: "Black", size: "M", skuCode: "ST-00001-BLK-M" },
    ]);

    expect(result.errors[0].reason).toContain('SKU code "ST-00001-BLK-M" is already in use');
  });
});

describe("importOpeningStockRowHandler — dependency-order enforcement", () => {
  it("rejects the row when the SKU (Product Variant) doesn't exist yet", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce(null);

    const result = await validateBulkImportRows(actor, "OPENING_STOCK", [{ skuCode: "MISSING-SKU", warehouse: "Main", quantity: "10" }]);

    expect(result.errors[0].reason).toContain('SKU "MISSING-SKU" not found');
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant SKU (variant exists but its product belongs to another company)", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce({
      id: "variant-1",
      productId: "prod-other",
      product: { companyId: "co-OTHER" },
    } as never);

    const result = await validateBulkImportRows(actor, "OPENING_STOCK", [{ skuCode: "ST-1", warehouse: "Main", quantity: "10" }]);

    expect(result.errors[0].reason).toContain('SKU "ST-1" not found');
  });

  it("rejects a non-positive quantity", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce({
      id: "variant-1",
      productId: "prod-1",
      product: { companyId: "co-1" },
    } as never);
    vi.mocked(prisma.warehouse.findFirst).mockResolvedValueOnce({ id: "wh-1" } as never);

    const result = await validateBulkImportRows(actor, "OPENING_STOCK", [{ skuCode: "ST-1", warehouse: "Main", quantity: "0" }]);

    expect(result.errors[0].reason).toContain("positive number");
    expect(importOpeningStockRow).not.toHaveBeenCalled();
  });

  it("validates successfully once SKU and warehouse both resolve — WITHOUT actually posting the ledger entry (dry-run must never post real stock)", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce({
      id: "variant-1",
      productId: "prod-1",
      product: { companyId: "co-1" },
    } as never);
    vi.mocked(prisma.warehouse.findFirst).mockResolvedValueOnce({ id: "wh-1" } as never);

    const result = await validateBulkImportRows(actor, "OPENING_STOCK", [{ skuCode: "ST-1", warehouse: "Main Godam", quantity: "100" }]);

    expect(result.validCount).toBe(1);
    expect(importOpeningStockRow).not.toHaveBeenCalled();
  });
});

describe("importChartOfAccountRow", () => {
  it("uppercases the account type and checks it for real via ChartOfAccountRepository, without ever calling createChartOfAccount", async () => {
    const result = await validateBulkImportRows(actor, "CHART_OF_ACCOUNT", [{ code: "1999", name: "Reserve", accountType: "asset" }]);

    expect(ChartOfAccountRepository.findByCode).toHaveBeenCalledWith("co-1", "1999");
    expect(result.validCount).toBe(1);
    expect(createChartOfAccount).not.toHaveBeenCalled();
  });

  it("reports a real duplicate account code as a row error", async () => {
    vi.mocked(ChartOfAccountRepository.findByCode).mockResolvedValueOnce({ id: "existing-coa" } as never);

    const result = await validateBulkImportRows(actor, "CHART_OF_ACCOUNT", [{ code: "1000", name: "Cash", accountType: "asset" }]);

    expect(result.errors[0].reason).toContain('Account code "1000" is already in use');
  });

  // Regression coverage for the reported gap: Parent Account was entirely
  // absent from the template/parser — mirrors importCategoryRow's own
  // parentCategory resolution (same helper, same by-code-or-name lookup).
  it("resolves an existing parent account by code or name and passes it through to createChartOfAccount", async () => {
    const parentId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(prisma.chartOfAccount.findFirst).mockResolvedValueOnce({ id: parentId } as never);

    await processBulkImportJob(
      "batch-1",
      "CHART_OF_ACCOUNT",
      actor,
      [{ code: "1010", name: "Petty Cash", accountType: "ASSET", parentAccount: "Cash" }],
      vi.fn()
    );

    expect(createChartOfAccount).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ code: "1010", name: "Petty Cash", accountType: "ASSET", parentAccountId: parentId })
    );
  });

  it("fails the row with a clear message when the parent account doesn't resolve", async () => {
    vi.mocked(prisma.chartOfAccount.findFirst).mockResolvedValue(null);

    const result = await validateBulkImportRows(actor, "CHART_OF_ACCOUNT", [
      { code: "1010", name: "Petty Cash", accountType: "ASSET", parentAccount: "Nonexistent" },
    ]);

    expect(result.errors[0].reason).toContain('Parent account "Nonexistent" not found');
    expect(createChartOfAccount).not.toHaveBeenCalled();
  });

  it("leaves parentAccountId unset when the column is blank, unaffected by the new lookup", async () => {
    const result = await validateBulkImportRows(actor, "CHART_OF_ACCOUNT", [{ code: "2000", name: "Bank", accountType: "asset" }]);
    expect(result.validCount).toBe(1);
    expect(prisma.chartOfAccount.findFirst).not.toHaveBeenCalled();
  });
});

// Regression coverage for the real bug found during live verification: an
// earlier version of validateBulkImportRows wrapped each row in
// `prisma.$transaction(async () => { await importRow(...); throw
// RollbackSentinel })`, intending the throw to roll back whatever the row
// wrote. It didn't — createCustomer/createSupplier/createProduct/
// createProductVariantExplicit all write through the shared `prisma`
// singleton directly, never through the transaction's own `tx` client, so
// nothing was actually scoped to that transaction and every write committed
// immediately regardless of the later throw. Confirmed live: clicking
// "Validate" alone created real, permanent Customer rows. These tests pin
// down the fix (an explicit dryRun flag that branches BEFORE the create
// call, never after) so this exact bug class can't silently return.
describe("validateBulkImportRows — never calls a real create/write function, for any master type", () => {
  beforeEach(() => {
    vi.mocked(GarmentAttributeRepository.supplierCategory.findFirst).mockResolvedValue({ id: FAKE_UUID } as never);
    vi.mocked(prisma.product.findFirst).mockResolvedValue({ id: "prod-1" } as never);
    vi.mocked(prisma.color.findFirst).mockResolvedValue({ id: "color-1" } as never);
    vi.mocked(prisma.size.findFirst).mockResolvedValue({ id: "size-1" } as never);
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValue({ id: "variant-1", productId: "prod-1", product: { companyId: "co-1" } } as never);
    vi.mocked(prisma.warehouse.findFirst).mockResolvedValue({ id: "wh-1" } as never);
  });

  it.each([
    ["CUSTOMER", { name: "Acme Apparel" }],
    ["SUPPLIER", { name: "Om Fabrics", category: "Fabric" }],
    ["PRODUCT", { styleName: "Round Neck Tee" }],
    ["PRODUCT_VARIANT", { styleCode: "ST-00001", color: "Black", size: "M", skuCode: "ST-00001-BLK-M" }],
    ["OPENING_STOCK", { skuCode: "ST-1", warehouse: "Main", quantity: "10" }],
    ["CHART_OF_ACCOUNT", { code: "1999", name: "Reserve", accountType: "ASSET" }],
  ] as const)("%s: reports valid without writing anything for real", async (masterType, row) => {
    const result = await validateBulkImportRows(actor, masterType, [row as Record<string, string>]);

    expect(result.validCount).toBe(1);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(createSupplier).not.toHaveBeenCalled();
    expect(createProduct).not.toHaveBeenCalled();
    expect(createProductVariantExplicit).not.toHaveBeenCalled();
    expect(createChartOfAccount).not.toHaveBeenCalled();
    expect(importOpeningStockRow).not.toHaveBeenCalled();
  });
});

// Tier 1 + Tier 2 masters added 2026-09-05 — covers the genuinely new logic
// (the shared makeSimpleCodeNameHandler factory, FK-by-code-or-name
// resolution, enum validation, boolean-cell parsing) rather than
// mechanically re-testing all 31 handlers, matching this project's own
// "test business logic, don't clone this file per entity" precedent.
describe("makeSimpleCodeNameHandler (via BRAND)", () => {
  it("rejects a missing code/name before ever touching the repository", async () => {
    const result = await validateBulkImportRows(actor, "BRAND", [{ name: "" }]);
    expect(result.errors[0].reason).toContain("Code is required");
    expect(GarmentAttributeRepository.brand.findFirst).not.toHaveBeenCalled();
  });

  it("reports a real duplicate code as a row error without calling createBrand", async () => {
    vi.mocked(GarmentAttributeRepository.brand.findFirst).mockResolvedValueOnce({ id: "existing" } as never);
    const result = await validateBulkImportRows(actor, "BRAND", [{ code: "BR-1", name: "Acme" }]);
    expect(result.errors[0].reason).toContain('Code "BR-1" is already in use');
    expect(createBrand).not.toHaveBeenCalled();
  });

  it("commits a valid row by calling createBrand with isActive: true", async () => {
    await processBulkImportJob("batch-1", "BRAND", actor, [{ code: "BR-1", name: "Acme" }], vi.fn());
    expect(createBrand).toHaveBeenCalledWith(actor, { code: "BR-1", name: "Acme", isActive: true });
  });
});

describe("importCategoryRow — self-referencing parent resolution", () => {
  it("resolves an existing parent by code or name", async () => {
    vi.mocked(GarmentAttributeRepository.category.findFirst)
      .mockResolvedValueOnce({ id: "parent-1" } as never) // parent lookup
      .mockResolvedValueOnce(null); // duplicate-code check
    const result = await validateBulkImportRows(actor, "CATEGORY", [{ code: "CAT-1", name: "Casual", parentCategory: "Apparel" }]);
    expect(result.validCount).toBe(1);
  });

  it("fails the row with a clear message when the parent category doesn't resolve", async () => {
    vi.mocked(GarmentAttributeRepository.category.findFirst).mockResolvedValue(null);
    const result = await validateBulkImportRows(actor, "CATEGORY", [{ code: "CAT-1", name: "Casual", parentCategory: "Nonexistent" }]);
    expect(result.errors[0].reason).toContain('Parent category "Nonexistent" not found');
    expect(createCategory).not.toHaveBeenCalled();
  });
});

describe("importFabricWidthRow — global Unit resolution", () => {
  it("resolves an existing unit by code or name and creates the width", async () => {
    vi.mocked(LookupRepository.unit.findFirst).mockResolvedValueOnce({ id: "unit-1" } as never);
    vi.mocked(FabricConfigRepository.width.findFirst).mockResolvedValueOnce(null);
    const result = await validateBulkImportRows(actor, "FABRIC_WIDTH", [{ code: "W-1", name: "150cm", unit: "cm" }]);
    expect(result.validCount).toBe(1);
  });

  it("fails with a clear message when the referenced unit doesn't exist", async () => {
    vi.mocked(LookupRepository.unit.findFirst).mockResolvedValue(null);
    const result = await validateBulkImportRows(actor, "FABRIC_WIDTH", [{ code: "W-1", name: "150cm", unit: "Nonexistent" }]);
    expect(result.errors[0].reason).toContain('Unit "Nonexistent" not found');
  });
});

describe("importDesignationRow — Department FK resolution", () => {
  it("resolves an existing department and creates the designation", async () => {
    vi.mocked(DepartmentRepository.findFirst).mockResolvedValueOnce({ id: "dept-1" } as never);
    vi.mocked(HrConfigRepository.designation.findFirst).mockResolvedValueOnce(null);
    const result = await validateBulkImportRows(actor, "DESIGNATION", [{ code: "D-1", name: "Line Supervisor", department: "Cutting" }]);
    expect(result.validCount).toBe(1);
  });
});

describe("importCostMasterRow — enum + numeric validation", () => {
  it("rejects an invalid cost master type", async () => {
    const result = await validateBulkImportRows(actor, "COST_MASTER", [{ code: "CM-1", name: "Overhead", type: "BOGUS", rate: "5" }]);
    expect(result.errors[0].reason).toContain("not a valid cost master type");
  });

  it("rejects a negative rate", async () => {
    const result = await validateBulkImportRows(actor, "COST_MASTER", [{ code: "CM-1", name: "Overhead", type: "FIXED", rate: "-5" }]);
    expect(result.errors[0].reason).toContain("non-negative number");
  });

  it("commits a valid PERCENTAGE-type row", async () => {
    await processBulkImportJob("batch-1", "COST_MASTER", actor, [{ code: "CM-1", name: "Commission", type: "percentage", rate: "5" }], vi.fn());
    expect(createCostMaster).toHaveBeenCalledWith(actor, { code: "CM-1", name: "Commission", type: "PERCENTAGE", rate: 5, isActive: true });
  });
});

describe("importPaymentTypeRow — enum validation", () => {
  it("rejects an invalid payment type", async () => {
    const result = await validateBulkImportRows(actor, "PAYMENT_TYPE", [{ code: "PT-1", name: "Wallet", type: "CRYPTO" }]);
    expect(result.errors[0].reason).toContain("not a valid payment type");
  });

  it("defaults to CASH when Type is blank", async () => {
    await processBulkImportJob("batch-1", "PAYMENT_TYPE", actor, [{ code: "PT-1", name: "Petty Cash" }], vi.fn());
    expect(createPaymentType).toHaveBeenCalledWith(actor, { code: "PT-1", name: "Petty Cash", type: "CASH", isActive: true });
  });
});

describe("importProductionStageRow — boolean-cell parsing", () => {
  it("parses true/false text into real booleans, with the documented defaults when blank", async () => {
    await processBulkImportJob(
      "batch-1",
      "PRODUCTION_STAGE",
      actor,
      [{ code: "STG-1", name: "Embroidery", sequence: "5", isFinal: "true", allowRework: "false" }],
      vi.fn()
    );
    expect(createProductionStage).toHaveBeenCalledWith(actor, {
      code: "STG-1",
      name: "Embroidery",
      sequence: 5,
      isActive: true,
      isFinal: true,
      allowRework: false,
      allowsExtraQuantity: false,
    });
  });

  it("defaults isFinal=false and allowRework=true when both columns are blank", async () => {
    await processBulkImportJob("batch-1", "PRODUCTION_STAGE", actor, [{ code: "STG-2", name: "QC" }], vi.fn());
    expect(createProductionStage).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ isFinal: false, allowRework: true, sequence: 0 })
    );
  });
});

describe("importMaterialRow — MATERIAL_CATEGORIES enum validation", () => {
  it("rejects an invalid material category", async () => {
    const result = await validateBulkImportRows(actor, "MATERIAL", [{ styleName: "Interlining", materialCategory: "NOT_A_CATEGORY" }]);
    expect(result.errors[0].reason).toContain("must be one of");
  });

  it("uppercases and accepts a valid category, auto-generating the item code", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValueOnce("MAT-00001" as never);
    const result = await validateBulkImportRows(actor, "MATERIAL", [{ styleName: "Interlining", materialCategory: "fabric" }]);
    expect(previewNextMasterCode).toHaveBeenCalledWith("co-1", "MATERIAL");
    expect(result.validCount).toBe(1);
    expect(createMaterial).not.toHaveBeenCalled();
  });
});

describe("makeGenericDeactivate — Undo path for the new 2026-09-05 lookup masters", () => {
  it("flips isActive to false via the repository delegate directly, audit-logged, for a tracked Brand record", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "COMPLETED" } as never);
    vi.mocked(ImportBatchRepository.findRecordsForBatch).mockResolvedValueOnce([
      { id: "r1", importBatchId: "batch-1", rowNumber: 1, tableName: "brands", recordId: "brand-1", createdAt: new Date() },
    ] as never);
    vi.mocked(GarmentAttributeRepository.brand.update).mockResolvedValueOnce({ id: "brand-1" } as never);

    const result = await undoBulkImportBatch(actor, "batch-1");

    expect(GarmentAttributeRepository.brand.update).toHaveBeenCalledWith({ where: { id: "brand-1" }, data: { isActive: false } });
    expect(result).toEqual({ totalRecords: 1, undone: 1, failures: [] });
  });

  it("reports no undo path for a Department record (no isActive column exists)", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "COMPLETED" } as never);
    vi.mocked(ImportBatchRepository.findRecordsForBatch).mockResolvedValueOnce([
      { id: "r1", importBatchId: "batch-1", rowNumber: 1, tableName: "departments", recordId: "dept-1", createdAt: new Date() },
    ] as never);

    const result = await undoBulkImportBatch(actor, "batch-1");

    expect(result.undone).toBe(0);
    expect(result.failures[0].reason).toContain("No undo path");
  });
});

// Warehouse + Employee (2026-09-05) — the two masters originally deferred
// pending their own design pass, mirroring the exact PRODUCT/PRODUCT_VARIANT
// and CATEGORY-self-reference patterns already covered above.
describe("importWarehouseRow", () => {
  it("rejects an invalid Type token before ever touching the repository", async () => {
    const result = await validateBulkImportRows(actor, "WAREHOUSE", [{ code: "WH-1", name: "Main", type: "NOT_A_TYPE" }]);
    expect(result.errors[0].reason).toContain("not valid");
    expect(WarehouseRepository.findByCodeInBranch).not.toHaveBeenCalled();
  });

  it("parses a comma-separated Type list and reports a real duplicate code as a row error", async () => {
    vi.mocked(WarehouseRepository.findByCodeInBranch).mockResolvedValueOnce({ id: "existing-wh" } as never);
    const result = await validateBulkImportRows(actor, "WAREHOUSE", [{ code: "WH-1", name: "Main", type: "raw_material, fabric" }]);
    expect(WarehouseRepository.findByCodeInBranch).toHaveBeenCalledWith("br-1", "WH-1");
    expect(result.errors[0].reason).toContain('Warehouse code "WH-1" is already in use');
    expect(createWarehouse).not.toHaveBeenCalled();
  });

  it("commits a valid row with the parsed Type array", async () => {
    await processBulkImportJob("batch-1", "WAREHOUSE", actor, [{ code: "WH-1", name: "Main", type: "RAW_MATERIAL,FABRIC" }], vi.fn());
    expect(createWarehouse).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1", branchId: "br-1" },
      { code: "WH-1", name: "Main", type: ["RAW_MATERIAL", "FABRIC"], isActive: true }
    );
  });
});

describe("importWarehouseLocationRow — dependency-order enforcement", () => {
  it("rejects the row when the parent warehouse doesn't exist yet", async () => {
    vi.mocked(WarehouseRepository.findByCodeInBranch).mockResolvedValueOnce(null);
    const result = await validateBulkImportRows(actor, "WAREHOUSE_LOCATION", [{ warehouse: "WH-99", code: "A1" }]);
    expect(result.errors[0].reason).toContain('Warehouse "WH-99" not found');
    expect(WarehouseLocationRepository.findByCode).not.toHaveBeenCalled();
  });

  it("rejects an invalid materialCategory", async () => {
    vi.mocked(WarehouseRepository.findByCodeInBranch).mockResolvedValue({ id: "wh-1" } as never);
    const result = await validateBulkImportRows(actor, "WAREHOUSE_LOCATION", [
      { warehouse: "WH-1", code: "A1", materialCategory: "NOT_A_CATEGORY" },
    ]);
    expect(result.errors[0].reason).toContain("not valid");
  });

  it("commits a valid row once the parent warehouse resolves", async () => {
    vi.mocked(WarehouseRepository.findByCodeInBranch).mockResolvedValue({ id: "wh-1" } as never);
    await processBulkImportJob("batch-1", "WAREHOUSE_LOCATION", actor, [{ warehouse: "WH-1", code: "A1", zone: "A" }], vi.fn());
    expect(createWarehouseLocation).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1", branchId: "br-1" },
      "wh-1",
      expect.objectContaining({ code: "A1", zone: "A" })
    );
  });
});

describe("importEmployeeRow", () => {
  it("auto-generates the employee code and rejects when the reporting manager doesn't exist", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValueOnce("EMP-00001" as never);
    vi.mocked(EmployeeRepository.findByCode).mockResolvedValueOnce(null);
    const result = await validateBulkImportRows(actor, "EMPLOYEE", [{ fullName: "Suresh Patil", reportsTo: "EMP-99" }]);
    expect(result.errors[0].reason).toContain('Reporting manager "EMP-99" not found');
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it("resolves Department/Designation/Shift/Category and the reporting manager, then commits", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValue("EMP-00002" as never);
    vi.mocked(DepartmentRepository.findFirst).mockResolvedValueOnce({ id: "dept-1" } as never);
    vi.mocked(HrConfigRepository.designation.findFirst).mockResolvedValueOnce({ id: "desg-1" } as never);
    vi.mocked(HrConfigRepository.employeeCategory.findFirst).mockResolvedValueOnce({ id: "cat-1" } as never);
    vi.mocked(HrConfigRepository.shiftMaster.findFirst).mockResolvedValueOnce({ id: "shift-1" } as never);
    vi.mocked(EmployeeRepository.findByCode).mockResolvedValueOnce({ id: "mgr-1" } as never);

    await processBulkImportJob(
      "batch-1",
      "EMPLOYEE",
      actor,
      [{ fullName: "Suresh Patil", department: "Cutting", designation: "Operator", employeeCategory: "Permanent", shift: "Day", reportsTo: "EMP-01" }],
      vi.fn()
    );

    expect(createEmployee).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        employeeCode: "EMP-00002",
        fullName: "Suresh Patil",
        departmentId: "dept-1",
        designationId: "desg-1",
        employeeCategoryId: "cat-1",
        shiftId: "shift-1",
        reportsToId: "mgr-1",
      })
    );
  });
});

describe("commitBulkImport", () => {
  it("persists the file, creates a QUEUED batch, and enqueues a job", async () => {
    vi.mocked(saveFile).mockResolvedValueOnce({ storageKey: "uploads/abc.csv" } as never);
    const queueAdd = vi.fn().mockResolvedValue({ id: "job-1" });
    vi.mocked(getBulkImportQueue).mockReturnValue({ add: queueAdd } as never);

    const result = await commitBulkImport(actor, "CUSTOMER", "customers.csv", Buffer.from("x"), "text/csv", [{ name: "Acme" }]);

    expect(ImportBatchRepository.createQueued).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", importType: "CUSTOMER", fileName: "customers.csv", totalRows: 1, originalFileKey: "uploads/abc.csv" })
    );
    expect(queueAdd).toHaveBeenCalledWith("CUSTOMER", expect.objectContaining({ batchId: "batch-1", masterType: "CUSTOMER" }));
    expect(ImportBatchRepository.setJobId).toHaveBeenCalledWith("batch-1", "job-1");
    expect(result).toEqual({ batchId: "batch-1", jobId: "job-1" });
  });

  it("still enqueues the batch when the original file fails to persist (non-fatal)", async () => {
    vi.mocked(saveFile).mockRejectedValueOnce(new Error("disk full"));
    const queueAdd = vi.fn().mockResolvedValue({ id: "job-2" });
    vi.mocked(getBulkImportQueue).mockReturnValue({ add: queueAdd } as never);

    await commitBulkImport(actor, "CUSTOMER", "customers.csv", Buffer.from("x"), "text/csv", [{ name: "Acme" }]);

    expect(ImportBatchRepository.createQueued).toHaveBeenCalledWith(expect.objectContaining({ originalFileKey: null }));
  });
});

describe("processBulkImportJob — worker-only per-row-isolation loop", () => {
  it("imports valid rows, reports failures, and finalizes with COMPLETED status", async () => {
    vi.mocked(createCustomer).mockResolvedValueOnce({ id: "cust-1" } as never).mockRejectedValueOnce(new BusinessRuleError("VALIDATION_ERROR", "bad row"));

    const onProgress = vi.fn();
    await processBulkImportJob("batch-1", "CUSTOMER", actor, [{ name: "Good" }, { name: "Bad" }], onProgress);

    expect(ImportBatchRepository.setStatus).toHaveBeenCalledWith("batch-1", "PROCESSING");
    expect(ImportBatchRepository.addRecord).toHaveBeenCalledWith(
      expect.objectContaining({ importBatchId: "batch-1", rowNumber: 1, tableName: "customers", recordId: "cust-1" })
    );
    expect(ImportBatchRepository.addRecord).toHaveBeenCalledTimes(1);
    expect(ImportBatchRepository.finalize).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ importedCount: 1, skippedCount: 1, status: "COMPLETED" })
    );
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("does not track an OPENING_STOCK row in ImportBatchRecord (no real record id to undo)", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce({
      id: "variant-1",
      productId: "prod-1",
      product: { companyId: "co-1" },
    } as never);
    vi.mocked(prisma.warehouse.findFirst).mockResolvedValueOnce({ id: "wh-1" } as never);

    await processBulkImportJob("batch-1", "OPENING_STOCK", actor, [{ skuCode: "ST-1", warehouse: "Main", quantity: "10" }], vi.fn());

    expect(ImportBatchRepository.addRecord).not.toHaveBeenCalled();
  });

  it("actually posts the Opening Stock ledger entry on a real (non-dry-run) commit", async () => {
    vi.mocked(prisma.productVariant.findUnique).mockResolvedValueOnce({
      id: "variant-1",
      productId: "prod-1",
      product: { companyId: "co-1" },
    } as never);
    vi.mocked(prisma.warehouse.findFirst).mockResolvedValueOnce({ id: "wh-1" } as never);

    await processBulkImportJob("batch-1", "OPENING_STOCK", actor, [{ skuCode: "ST-1", warehouse: "Main", quantity: "10" }], vi.fn());

    expect(importOpeningStockRow).toHaveBeenCalledWith(actor, expect.objectContaining({ productId: "prod-1", warehouseId: "wh-1", quantity: 10 }));
  });
});

describe("undoBulkImportBatch", () => {
  it("deactivates every tracked record via its own table's deactivate function", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "COMPLETED" } as never);
    vi.mocked(ImportBatchRepository.findRecordsForBatch).mockResolvedValueOnce([
      { id: "r1", importBatchId: "batch-1", rowNumber: 1, tableName: "customers", recordId: "cust-1", createdAt: new Date() },
      { id: "r2", importBatchId: "batch-1", rowNumber: 2, tableName: "products", recordId: "prod-1", createdAt: new Date() },
    ] as never);

    const result = await undoBulkImportBatch(actor, "batch-1");

    expect(deactivateCustomer).toHaveBeenCalledWith(actor, "cust-1");
    expect(setProductActiveStatus).toHaveBeenCalledWith(actor, "prod-1", false);
    expect(result).toEqual({ totalRecords: 2, undone: 2, failures: [] });
    expect(ImportBatchRepository.setStatus).toHaveBeenCalledWith("batch-1", "UNDONE");
  });

  it("rejects undoing a batch that isn't COMPLETED", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "PROCESSING" } as never);

    await expect(undoBulkImportBatch(actor, "batch-1")).rejects.toThrow(/still "PROCESSING"/);
  });

  it("rejects undoing an already-UNDONE batch", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "UNDONE" } as never);

    await expect(undoBulkImportBatch(actor, "batch-1")).rejects.toThrow(/already been undone/);
  });

  it("tolerates one record's deactivate failing and still reports the rest as undone", async () => {
    vi.mocked(ImportBatchRepository.findByIdWithDetails).mockResolvedValueOnce({ id: "batch-1", status: "COMPLETED" } as never);
    vi.mocked(ImportBatchRepository.findRecordsForBatch).mockResolvedValueOnce([
      { id: "r1", importBatchId: "batch-1", rowNumber: 1, tableName: "customers", recordId: "cust-1", createdAt: new Date() },
      { id: "r2", importBatchId: "batch-1", rowNumber: 2, tableName: "suppliers", recordId: "supp-1", createdAt: new Date() },
    ] as never);
    vi.mocked(deactivateCustomer).mockRejectedValueOnce(new Error("already referenced elsewhere"));

    const result = await undoBulkImportBatch(actor, "batch-1");

    expect(result.undone).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(deactivateSupplier).toHaveBeenCalledWith(actor, "supp-1");
  });
});
