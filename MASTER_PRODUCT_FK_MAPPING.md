# Master Modules & Product FK Mapping — Inspection Report

**Scope**: Inspection only, no code changes. Source: `prisma/schema.prisma` (current state), `src/modules/products/product.schema.ts`, `src/modules/products/product.service.ts`. Every table/field/enum name below is copied verbatim from the codebase — nothing invented.

All models are Postgres tables via Prisma, PK is always `id: String @id @default(uuid()) @db.Uuid` (UUID, generated) unless noted otherwise.

---

## 1. Master Modules (relevant to `Product` FK relationships)

Only masters that are either already linked to `Product`, or are shaped like a plausible `Product`-level attribute, are detailed here. Masters judged not relevant (HR, finance, production-planning, etc.) are listed with reasons only in the **Not Recommended** section at the end — full field breakdown for those would be noise for this report's purpose.

| Module Name | Table Name | Field Name | Key | Type | Required | Description |
|---|---|---|---|---|---|---|
| **Category** — `Already Connected` | `categories` | ID | `id` | String (UUID) | Yes | Primary key |
| Category | `categories` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Category | `categories` | Code | `code` | String | Yes | Unique per company with `name` |
| Category | `categories` | Name | `name` | String | Yes | Display name |
| Category | `categories` | Active | `isActive` | Boolean | Yes (default true) | Enable/disable flag |
| Category | `categories` | Created At | `createdAt` | DateTime | Yes | Audit |
| Category | `categories` | Updated At | `updatedAt` | DateTime | Yes | Audit |
| **Season** — `Already Connected` | `seasons` | ID | `id` | String (UUID) | Yes | Primary key |
| Season | `seasons` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Season | `seasons` | Code | `code` | String | Yes | Unique per company with `name` |
| Season | `seasons` | Name | `name` | String | Yes | Display name |
| Season | `seasons` | Active | `isActive` | Boolean | Yes (default true) | Enable/disable flag |
| Season | `seasons` | Created At | `createdAt` | DateTime | Yes | Audit |
| Season | `seasons` | Updated At | `updatedAt` | DateTime | Yes | Audit |
| **Supplier** — `Already Connected` | `suppliers` | ID | `id` | String (UUID) | Yes | Primary key |
| Supplier | `suppliers` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Supplier | `suppliers` | Code | `code` | String | Yes | Unique per company with `name` |
| Supplier | `suppliers` | Name | `name` | String | Yes | Display name |
| Supplier | `suppliers` | Category | `category` | Enum `SupplierCategory` (FABRIC\|TRIMS\|ACCESSORIES\|PACKAGING\|SERVICES\|MACHINERY\|OTHER) | Yes | Supplier's business category |
| Supplier | `suppliers` | Contact Person | `contactPerson` | String? | No | |
| Supplier | `suppliers` | Email | `email` | String? | No | |
| Supplier | `suppliers` | Phone | `phone` | String? | No | |
| Supplier | `suppliers` | Address | `address` | String? | No | |
| Supplier | `suppliers` | Tax Reg. No. | `taxRegistrationNo` | String? | No | |
| Supplier | `suppliers` | Payment Terms | `paymentTermsDays` | Int? | No | |
| Supplier | `suppliers` | Default Currency | `defaultCurrencyCode` | String? (Char 3) | No | |
| Supplier | `suppliers` | Bank Details | `bankDetailsJson` | Json? | No | |
| Supplier | `suppliers` | Active | `isActive` | Boolean | Yes (default true) | |
| Supplier | `suppliers` | Deleted At | `deletedAt` | DateTime? | No | Soft delete |
| **UnitOfMeasure** — `Already Connected` | `units_of_measure` | ID | `id` | String (UUID) | Yes | Primary key |
| UnitOfMeasure | `units_of_measure` | Code | `code` | String | Yes | Globally unique (not company-scoped — only global lookup in the schema) |
| UnitOfMeasure | `units_of_measure` | Name | `name` | String | Yes | |
| UnitOfMeasure | `units_of_measure` | Base Unit | `baseUnitId` | String? (UUID, self-FK) | No | For unit conversion hierarchy |
| UnitOfMeasure | `units_of_measure` | Conversion Factor | `conversionFactor` | Decimal(18,6) | Yes (default 1) | |
| **Customer** — `Already Connected` | `customers` | ID | `id` | String (UUID) | Yes | Primary key |
| Customer | `customers` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Customer | `customers` | Code | `code` | String | Yes | Unique per company |
| Customer | `customers` | Name | `name` | String | Yes | |
| Customer | `customers` | Type | `type` | String (default "CUSTOMER") | Yes | Plain string, not an enum |
| Customer | `customers` | Country | `country` | String? | No | |
| Customer | `customers` | Payment Terms | `paymentTermsDays` | Int? | No | |
| Customer | `customers` | Credit Limit | `creditLimit` | Decimal(18,2)? | No | |
| Customer | `customers` | Default Currency | `defaultCurrencyCode` | String? (Char 3) | No | |
| Customer | `customers` | Active | `isActive` | Boolean | Yes (default true) | |
| Customer | `customers` | Deleted At | `deletedAt` | DateTime? | No | Soft delete |
| **Department** — `Partially Connected (broken)` | `departments` | ID | `id` | String (UUID) | Yes | Primary key |
| Department | `departments` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Department | `departments` | Branch | `branchId` | String? (UUID, FK→branches) | No | |
| Department | `departments` | Name | `name` | String | Yes | |
| Department | `departments` | Code | `code` | String | Yes | Unique per company |
| **Brand** — `Standalone → Candidate for Product FK` | `brands` | ID | `id` | String (UUID) | Yes | Primary key |
| Brand | `brands` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Brand | `brands` | Code | `code` | String | Yes | Unique per company |
| Brand | `brands` | Name | `name` | String | Yes | |
| Brand | `brands` | Active | `isActive` | Boolean | Yes (default true) | |
| **ProductFitting** — `Standalone → Candidate for Product FK` | `product_fittings` | ID | `id` | String (UUID) | Yes | Primary key |
| ProductFitting | `product_fittings` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| ProductFitting | `product_fittings` | Code | `code` | String | Yes | Unique per company |
| ProductFitting | `product_fittings` | Name | `name` | String | Yes | e.g. "Slim Fit", "Regular Fit" |
| ProductFitting | `product_fittings` | Active | `isActive` | Boolean | Yes (default true) | |
| **ProductType** — `Standalone → Candidate for Product FK` | `product_types` | ID | `id` | String (UUID) | Yes | Primary key |
| ProductType | `product_types` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| ProductType | `product_types` | Code | `code` | String | Yes | Unique per company |
| ProductType | `product_types` | Name | `name` | String | Yes | e.g. "Jeans", "Shirt" |
| ProductType | `product_types` | Active | `isActive` | Boolean | Yes (default true) | |
| **Design** — `Standalone → Candidate for Product FK` | `designs` | ID | `id` | String (UUID) | Yes | Primary key |
| Design | `designs` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Design | `designs` | Code | `code` | String | Yes | Unique per company |
| Design | `designs` | Name | `name` | String | Yes | |
| Design | `designs` | Active | `isActive` | Boolean | Yes (default true) | |
| **DesignPattern** — `Standalone → Candidate for Product FK` | `design_patterns` | ID | `id` | String (UUID) | Yes | Primary key |
| DesignPattern | `design_patterns` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| DesignPattern | `design_patterns` | Code | `code` | String | Yes | Unique per company |
| DesignPattern | `design_patterns` | Name | `name` | String | Yes | |
| DesignPattern | `design_patterns` | Active | `isActive` | Boolean | Yes (default true) | |
| **Pattern** — `Standalone → Candidate for Product FK` | `patterns` | ID | `id` | String (UUID) | Yes | Primary key |
| Pattern | `patterns` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Pattern | `patterns` | Code | `code` | String | Yes | Unique per company |
| Pattern | `patterns` | Name | `name` | String | Yes | |
| Pattern | `patterns` | Active | `isActive` | Boolean | Yes (default true) | |
| **FabricGsm** — `Standalone → Candidate for Product FK` | `fabric_gsms` | ID | `id` | String (UUID) | Yes | Primary key |
| FabricGsm | `fabric_gsms` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| FabricGsm | `fabric_gsms` | Code | `code` | String | Yes | Unique per company |
| FabricGsm | `fabric_gsms` | Name | `name` | String | Yes | e.g. "180 GSM" |
| FabricGsm | `fabric_gsms` | Active | `isActive` | Boolean | Yes (default true) | |
| **FabricDye** — `Standalone → Candidate for Product FK` | `fabric_dyes` | ID | `id` | String (UUID) | Yes | Primary key |
| FabricDye | `fabric_dyes` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| FabricDye | `fabric_dyes` | Code | `code` | String | Yes | Unique per company |
| FabricDye | `fabric_dyes` | Name | `name` | String | Yes | |
| FabricDye | `fabric_dyes` | Pantone | `pantone` | String? | No | Pantone reference code |
| FabricDye | `fabric_dyes` | Active | `isActive` | Boolean | Yes (default true) | |
| **FabricWeaveType** — `Standalone → Candidate for Product FK` | `fabric_weave_types` | ID | `id` | String (UUID) | Yes | Primary key |
| FabricWeaveType | `fabric_weave_types` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| FabricWeaveType | `fabric_weave_types` | Code | `code` | String | Yes | Unique per company |
| FabricWeaveType | `fabric_weave_types` | Name | `name` | String | Yes | |
| FabricWeaveType | `fabric_weave_types` | Active | `isActive` | Boolean | Yes (default true) | |
| **FabricWidth** — `Standalone → Candidate for Product FK` | `fabric_widths` | ID | `id` | String (UUID) | Yes | Primary key |
| FabricWidth | `fabric_widths` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| FabricWidth | `fabric_widths` | Code | `code` | String | Yes | Unique per company |
| FabricWidth | `fabric_widths` | Name | `name` | String | Yes | |
| FabricWidth | `fabric_widths` | Unit | `unit` | String (default "cm") | Yes | |
| FabricWidth | `fabric_widths` | Active | `isActive` | Boolean | Yes (default true) | |
| **FabricComposition** — `Standalone → Candidate for Product FK` | `fabric_compositions` | ID | `id` | String (UUID) | Yes | Primary key |
| FabricComposition | `fabric_compositions` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| FabricComposition | `fabric_compositions` | Code | `code` | String | Yes | Unique per company |
| FabricComposition | `fabric_compositions` | Name | `name` | String | Yes | e.g. "100% Cotton" |
| FabricComposition | `fabric_compositions` | Active | `isActive` | Boolean | Yes (default true) | |
| **Color** — `Already Connected (indirect, via ProductVariant)` | `colors` | ID | `id` | String (UUID) | Yes | Primary key |
| Color | `colors` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Color | `colors` | Code | `code` | String | Yes | Unique per company |
| Color | `colors` | Name | `name` | String | Yes | |
| Color | `colors` | Hex Value | `hexValue` | String? | No | |
| **Size** — `Already Connected (indirect, via ProductVariant)` | `sizes` | ID | `id` | String (UUID) | Yes | Primary key |
| Size | `sizes` | Company | `companyId` | String (UUID, FK→companies) | Yes | Tenant scope |
| Size | `sizes` | Code | `code` | String | Yes | Unique per company |
| Size | `sizes` | Name | `name` | String | Yes | |
| Size | `sizes` | Sort Order | `sortOrder` | Int | Yes (default 0) | |

**Existing relations, per module** (only where a real Prisma `@relation` exists — declared on both sides of the relation):
- **Category** ↔ `Product.categoryId` (one Category → many Products); ↔ `Company` (owner)
- **Season** ↔ `Product.seasonId` (one Season → many Products); ↔ `Company`
- **Supplier** ↔ `Product.defaultSupplierId` (relation name `defaultForProducts`); ↔ `Company`
- **UnitOfMeasure** ↔ `Product.baseUomId`; self-relation `baseUnitId`/`derived` for conversion chains; ↔ no `Company` (global table)
- **Customer** ↔ `Product.customerId`; ↔ `Buyer[]`; ↔ `Company`
- **Department** ↔ `Employee.departmentId`, `ProductionLine.departmentId` — **but NOT `Product`** despite `Product.departmentId` existing as a raw column (see Section 2)
- **Brand, ProductFitting, ProductType, Design, DesignPattern, Pattern, FabricGsm, FabricDye, FabricWeaveType, FabricWidth, FabricComposition** — only relation each has is ↔ `Company` (owner). **Zero relation to `Product`.** No placeholder FK column exists on `Product` for any of these — they'd need a brand-new column, not just a new relation line.
- **Color, Size** ↔ `ProductVariant.colorId`/`sizeId` ↔ `Product` (via `ProductVariant`, not a direct FK on `Product` itself)

---

## 2. Product Table — Current Fields

Table: `products`, mapped from Prisma model `Product`. This one table serves both Styles (`itemType = STYLE`) and Raw Materials (`itemType = RAW_MATERIAL`) — see `itemType` below.

| Field Name | Key | Type | Required | Current Purpose |
|---|---|---|---|---|
| ID | `id` | String (UUID) | Yes | Primary key |
| Company | `companyId` | String (UUID, FK→`companies`) | Yes | Tenant scope |
| Customer | `customerId` | String? (UUID, FK→`customers`) | No | Style's owning customer (Style only, exposed in `productSchema`) |
| Department | `departmentId` | String? (UUID) | No | **Column exists, no `@relation` declared, not exposed in `productSchema`/`materialSchema` — dead/orphan column, currently unusable from the app** |
| Base UOM | `baseUomId` | String? (UUID, FK→`units_of_measure`) | No | Materials only, exposed in `materialSchema` |
| Default Supplier | `defaultSupplierId` | String? (UUID, FK→`suppliers`) | No | Materials only, exposed in `materialSchema` |
| Item Type | `itemType` | Enum `ItemType` (STYLE \| RAW_MATERIAL) | Yes (default STYLE) | Discriminator — same table serves Styles and Raw Materials |
| Material Category | `materialCategory` | Enum `SupplierCategory`? (reused enum) | No | Materials only, exposed as `materialCategory` in `materialSchema` (its own enum list `MATERIAL_CATEGORIES` = FABRIC\|TRIMS\|ACCESSORIES\|PACKAGING\|OTHER, a subset of `SupplierCategory`) |
| Style Code | `styleCode` | String | Yes | Unique per company (shared namespace with Materials) |
| Style Name | `styleName` | String | Yes | |
| Category | `categoryId` | String? (UUID, FK→`categories`) | No | **Already an FK** — style-level category (e.g. "Denim") |
| Season | `seasonId` | String? (UUID, FK→`seasons`) | No | **Already an FK** |
| Gender | `gender` | String? | No | **Free text — no master module exists for Gender anywhere in the project** |
| Description | `description` | String? | No | |
| Image URL | `imageUrl` | String? | No | Plain string, not an `Attachment` relation |
| HSN/SAC Code | `hsnSacCode` | String? | No | |
| Reorder Level | `reorderLevel` | Decimal(18,4)? | No | Materials only |
| Unit Cost | `unitCost` | Decimal(18,2)? | No | Materials only |
| Active | `isActive` | Boolean | Yes (default true) | |
| Deleted At | `deletedAt` | DateTime? | No | Soft delete |
| Created At | `createdAt` | DateTime | Yes | Audit |
| Updated At | `updatedAt` | DateTime | Yes | Audit |

**Specifically identified, as requested:**
- **`category`/`categoryId`**: Exists as `categoryId` (real FK → `categories.id`). The old free-text `category` string column was already migrated away — no plain-string `category` field remains on `Product`.
- **`season`/`seasonId`**: Exists as `seasonId` (real FK → `seasons.id`). Same situation — old free-text `season` string is already gone.
- **Fabric-related fields**: **None exist on `Product`.** No `gsmId`, `dyeId`, `weaveTypeId`, `widthId`, or `compositionId` columns — the 5 Fabric sub-masters are 100% standalone with no placeholder on `Product` at all.
- **Garment-related fields**: `gender` (free text, no master exists for it). No `fittingId`, `productTypeId`, `designId`, `designPatternId`, or `patternId` columns exist either — same "fully standalone, no placeholder" situation as fabric.
- **Production-related fields**: `materialCategory` (enum, Materials-only), `baseUomId`, `defaultSupplierId`, `reorderLevel`, `unitCost` — all Materials-only, already wired as real FKs/columns.
- **Existing free-text fields that are FK candidates**: `gender` is the only genuinely free-text field left on `Product` with no matching master — but no Gender master module exists yet in the codebase, so there's nothing to point it at today. `departmentId` is not free text (it's already a UUID column) but is a **broken FK** — the relation was never declared in Prisma, so it produces no DB foreign-key constraint and isn't reachable from the API layer at all.

---

## 3. Recommended Product FK Mapping

| Master Module | Master Table | Master PK | Product FK Field | Relation | Notes |
|---|---|---|---|---|---|
| Category | `categories` | `id` | `categoryId` | Product → Category | Already implemented |
| Season | `seasons` | `id` | `seasonId` | Product → Season | Already implemented |
| Supplier | `suppliers` | `id` | `defaultSupplierId` | Product → Supplier | Already implemented (Materials) |
| UnitOfMeasure | `units_of_measure` | `id` | `baseUomId` | Product → UnitOfMeasure | Already implemented (Materials) |
| Customer | `customers` | `id` | `customerId` | Product → Customer | Already implemented (Styles) |
| Department | `departments` | `id` | `departmentId` | Product → Department | **Fix, not add** — column exists, only the `@relation` declaration + back-relation on `Department`/`Company` need adding |
| Brand | `brands` | `id` | `brandId` | Product → Brand | New column needed |
| ProductFitting | `product_fittings` | `id` | `fittingId` | Product → ProductFitting | New column needed |
| ProductType | `product_types` | `id` | `productTypeId` | Product → ProductType | New column needed |
| Design | `designs` | `id` | `designId` | Product → Design | New column needed |
| DesignPattern | `design_patterns` | `id` | `designPatternId` | Product → DesignPattern | New column needed |
| Pattern | `patterns` | `id` | `patternId` | Product → Pattern | New column needed |
| FabricGsm | `fabric_gsms` | `id` | `gsmId` | Product → FabricGsm | New column needed; fabric-category Materials only |
| FabricDye | `fabric_dyes` | `id` | `dyeId` | Product → FabricDye | New column needed; fabric-category Materials only |
| FabricWeaveType | `fabric_weave_types` | `id` | `weaveTypeId` | Product → FabricWeaveType | New column needed; fabric-category Materials only |
| FabricWidth | `fabric_widths` | `id` | `widthId` | Product → FabricWidth | New column needed; fabric-category Materials only |
| FabricComposition | `fabric_compositions` | `id` | `compositionId` | Product → FabricComposition | New column needed; fabric-category Materials only |

Column names above are proposed for naming-convention consistency with the existing `categoryId`/`seasonId` pattern — not yet implemented anywhere.

---

## 4. Final Summary

### Already Connected
- **Category** → `Product.categoryId`
- **Season** → `Product.seasonId`
- **Supplier** → `Product.defaultSupplierId`
- **UnitOfMeasure** → `Product.baseUomId`
- **Customer** → `Product.customerId`
- **Color**, **Size** → connected to `Product` indirectly through the child `ProductVariant` table (`ProductVariant.colorId`/`sizeId`), not a direct FK on `Product` itself — this is architecturally correct as-is (a Style has many Color×Size variants), not a gap.

### Candidate Product FKs
Standalone today, shaped like a `Product`-level attribute, no existing column at all:
- **Brand**
- **ProductFitting**
- **ProductType**
- **Design**
- **DesignPattern**
- **Pattern**
- **FabricGsm**
- **FabricDye**
- **FabricWeaveType**
- **FabricWidth**
- **FabricComposition**

Special case — **Department**: not "standalone" in the sense above (a `departmentId` column already exists on `Product`), but the Prisma `@relation` was never declared, so it has no working relation and no DB-level foreign key. This needs a **relation fix**, not a new column.

### Not Recommended
Masters that exist in the project but don't fit as a direct `Product` FK:
- **Machine, ProductionLine, ProductionStage** — production-floor/planning entities, scoped to a production order or work-in-progress lot, not to a Style/Material definition.
- **Designation, EmployeeCategory, ShiftMaster, HolidayMaster** — HR domain, no conceptual link to a product.
- **CostMaster** — an overhead cost rate used in production/BOM costing calculations, not a per-style descriptive attribute; would belong on a BOM/production-order line, not on `Product` directly.
- **PaymentType, BankAccount** — finance/payment domain, unrelated to product definition.
- **SalesAgent** — sales-channel entity, relates to Sales Orders, not Products.
- **Warehouse, WarehouseLocation** — inventory location masters; a "default warehouse" on `Product` isn't currently modeled or requested, and stock location is more naturally tracked per-transaction than per-Style.
- **Buyer** — child of `Customer`, not a `Product`-level concept.

No code was changed for this report — schema, services, and routes are exactly as they were before this inspection.
