import type { Module } from "@/config/rbac";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { PurchaseOrderRepository } from "@/modules/purchasing/purchase-order.repository";
import { MaterialRequestRepository } from "@/modules/inventory/material-request.repository";
import { ProductionOrderRepository } from "@/modules/production/production.repository";
import { SampleRequestRepository } from "@/modules/sampling/sample.repository";
import { BuyerEnquiryRepository } from "@/modules/buyer-enquiries/buyer-enquiry.repository";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { ProductRepository } from "@/modules/products/product.repository";

export interface GlobalSearchResultItem {
  id: string;
  /** Primary identifier — the record number, or name for a master-data row. */
  primary: string;
  /** One line of secondary context (counterparty name, code, style, ...). Null when there's genuinely nothing to show. */
  secondary: string | null;
  href: string;
}

export interface GlobalSearchGroup {
  module: Module;
  label: string;
  items: GlobalSearchResultItem[];
}

export interface GlobalSearchResult {
  groups: GlobalSearchGroup[];
}

const MIN_QUERY_LENGTH = 2;
const PER_GROUP_LIMIT = 5;
// A dropdown-sized cap across ALL groups combined, distinct from the
// per-group cap above — protects against a broad term (e.g. a single common
// digit) matching all ten entity types at once and rendering an unwieldy
// list. Applied by merging groups in the priority order they're declared
// below (transactional documents first, since a number-shaped query is more
// likely aimed at a document than a master record), including whole groups
// until the budget runs out rather than truncating one mid-group.
const OVERALL_RESULT_CAP = 20;

interface SearchEntityConfig {
  module: Module;
  label: string;
  search: (companyId: string, term: string, limit: number) => Promise<GlobalSearchResultItem[]>;
}

// Declaration order doubles as merge priority for OVERALL_RESULT_CAP — see
// its own comment above. Each entry reuses that module's own existing
// `searchTop*` repository function (added alongside this file, one small
// additive export per module — never a duplicated query), and every one of
// those functions already scopes by `companyId` exactly like every other
// list endpoint in this codebase.
const SEARCH_ENTITIES: SearchEntityConfig[] = [
  {
    module: "sales_orders",
    label: "Sales Orders",
    search: async (companyId, term, limit) => {
      const rows = await SalesOrderRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.orderNumber,
        secondary: r.customer?.name ?? null,
        href: `/sales-orders/${r.id}`,
      }));
    },
  },
  {
    module: "purchase_order",
    label: "Purchase Orders",
    search: async (companyId, term, limit) => {
      const rows = await PurchaseOrderRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.orderNumber,
        secondary: r.supplier?.name ?? null,
        href: `/purchase-orders/${r.id}`,
      }));
    },
  },
  {
    module: "sampling",
    label: "Sample Requests",
    search: async (companyId, term, limit) => {
      const rows = await SampleRequestRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.requestNumber,
        secondary: r.customer?.name ?? null,
        href: `/sampling/${r.id}`,
      }));
    },
  },
  {
    module: "buyer_enquiries",
    label: "Buyer Enquiries",
    search: async (companyId, term, limit) => {
      const rows = await BuyerEnquiryRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.enquiryNumber,
        secondary: r.customer?.name ?? r.prospectName ?? null,
        href: `/buyer-enquiries/${r.id}`,
      }));
    },
  },
  {
    module: "material_request",
    label: "Material Requests",
    search: async (companyId, term, limit) => {
      const rows = await MaterialRequestRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.requestNumber,
        secondary: r.department?.name ?? r.warehouse?.name ?? null,
        href: `/material-requests/${r.id}`,
      }));
    },
  },
  {
    module: "production",
    label: "Production Orders",
    search: async (companyId, term, limit) => {
      const rows = await ProductionOrderRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.orderNumber,
        secondary: r.product?.styleName ?? null,
        href: `/production-orders/${r.id}`,
      }));
    },
  },
  {
    module: "masters_core",
    label: "Customers",
    search: async (companyId, term, limit) => {
      const rows = await CustomerRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.name,
        secondary: r.code,
        href: `/masters/customers/${r.id}`,
      }));
    },
  },
  {
    module: "masters_core",
    label: "Suppliers",
    search: async (companyId, term, limit) => {
      const rows = await SupplierRepository.searchTop(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.name,
        secondary: r.code,
        href: `/masters/suppliers/${r.id}`,
      }));
    },
  },
  {
    module: "masters_core",
    label: "Products / Styles",
    search: async (companyId, term, limit) => {
      const rows = await ProductRepository.searchTopStyles(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.styleName,
        secondary: r.styleCode,
        href: `/masters/products/${r.id}`,
      }));
    },
  },
  {
    module: "masters_core",
    label: "Raw Materials",
    search: async (companyId, term, limit) => {
      const rows = await ProductRepository.searchTopMaterials(companyId, term, limit);
      return rows.map((r) => ({
        id: r.id,
        primary: r.styleName,
        secondary: r.styleCode,
        href: `/masters/materials/${r.id}`,
      }));
    },
  },
];

/**
 * The Topbar Global Search's one orchestration point. Deliberately does no
 * querying of its own — every entity's actual `where` predicate lives on
 * that entity's own repository (`searchTop*`), exactly mirroring what that
 * module's own list endpoint already does. This function only decides WHICH
 * groups run (tenant + RBAC), runs them in parallel, and shapes/caps the
 * combined result.
 *
 * No document-number-prefix translation happens here or anywhere in this
 * feature (e.g. a user typing "SO" is never rewritten to "ORD") — every
 * predicate is a plain `contains`, so a partial number/date fragment
 * ("2026-0012", "0012") matches regardless of which prefix the user assumes.
 */
export async function searchGlobal(
  actor: { userId: string; companyId: string },
  rawTerm: string
): Promise<GlobalSearchResult> {
  const term = rawTerm.trim();
  if (term.length < MIN_QUERY_LENGTH) return { groups: [] };

  const viewableModules = await PermissionService.getViewableModules(actor.userId);
  const canView = (module: Module) => viewableModules === "all" || viewableModules.has(module);

  // Modules the user can't view are skipped BEFORE any query runs — never
  // queried-then-filtered. A suspended/nonexistent user (getViewableModules
  // returns an empty Set in that case) simply gets zero groups back.
  const enabledEntities = SEARCH_ENTITIES.filter((entity) => canView(entity.module));

  const perGroupResults = await Promise.all(
    enabledEntities.map(async (entity) => ({
      entity,
      items: await entity.search(actor.companyId, term, PER_GROUP_LIMIT),
    }))
  );

  const groups: GlobalSearchGroup[] = [];
  let remainingBudget = OVERALL_RESULT_CAP;
  for (const { entity, items } of perGroupResults) {
    if (items.length === 0 || remainingBudget <= 0) continue;
    const slice = items.slice(0, remainingBudget);
    groups.push({ module: entity.module, label: entity.label, items: slice });
    remainingBudget -= slice.length;
  }

  return { groups };
}
