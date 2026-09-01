# Fashion ERP — Component Guidelines

Component-level rules: naming, when to share vs. localize, and the exact API contracts of the shared
primitives under `src/components/ui/`. Pairs with `DESIGN_SYSTEM.md` (visual values) and `UI_RULES.md`
(interaction behavior). Every rule cites a real file.

## 1. Naming Conventions Actually Observed

All PascalCase, one component per file, filename == exported component name. Suffixes are used
consistently and mean specific things — don't use them interchangeably:

| Suffix | Meaning | Count (Glob) | Example |
|---|---|---|---|
| `*Form.tsx` | A page-level create/edit form, usually dual-mode (create when no `initial*` prop, edit when one is passed) | 27 files | `src/app/(dashboard)/sales-orders/SalesOrderForm.tsx`, `masters/customers/CustomerForm.tsx` |
| `*WorkflowPanel.tsx` | The Client Component half of a detail page's "Server Component page + one Client Component panel" split — renders status, action buttons, and any sub-forms/modals for a transactional record's lifecycle | 20 files | `sales-orders/SalesOrderWorkflowPanel.tsx`, `sampling/SampleWorkflowPanel.tsx` |
| `*Section.tsx` | A self-contained sub-block of a parent detail page, usually with its own self-fetch — for genuinely child data of a parent record (not a full workflow of its own) | 6 files | `masters/products/VariantsSection.tsx`, `masters/customers/BuyersSection.tsx`, `masters/suppliers/SuppliedMaterialsSection.tsx` |
| `*ListClient.tsx` | The Client Component half of a list page split out specifically so the sibling `page.tsx` can be an `async` Server Component doing a permission check first | 3 files (emerging pattern, see § 6) | `accounts/journals/JournalsListClient.tsx`, `accounts/payments/PaymentsListClient.tsx` |
| `statusLabels.ts` | Per-module status label + badge-color map (not a component — a plain data file) | 9 files | `sales-orders/statusLabels.ts`, `sampling/statusLabels.ts` |
| `page.tsx` | The Next.js route entry — either a Server Component doing data-fetch + light composition (detail pages), or (today, inconsistently) a `"use client"` list page (see § 6) | — | `sales-orders/[id]/page.tsx` |

**Rule**: when adding a new module, follow the existing suffix that matches your component's actual role —
don't invent a new suffix (`*View.tsx`, `*Container.tsx`, etc.) for something that's really a `*Section`/
`*WorkflowPanel`/`*Form`.

## 2. When to Build a Shared Component (`src/components/ui/`) vs. a Local One-Off

The real, current inventory in `src/components/ui/` is exactly: `DataTable`, `Modal`, `ConfirmModal`,
`FormField`, `Breadcrumb`, `ToggleSwitch`, `FilePreviewModal`, `MaterialPicker`, `SimpleLookupManager`,
`CsvImportModal`, `Barcode`. Every one of these was promoted **after** the same need appeared in multiple
modules — none were built speculatively ahead of a second real consumer (`MaterialPicker`'s own doc comment
states this explicitly: "Reused everywhere a 'pick a raw material' field exists... instead of every module
re-implementing its own grouping/search UI," `MaterialPicker.tsx:33-35`).

**Converged rule, evidenced by the codebase's own history**: build local first, promote to shared once a
genuine second consumer needs the identical behavior — not before. Two concrete signals from this codebase
of when that threshold was crossed:
- `Barcode.tsx` was built for Sales Orders alone, with its own doc comment anticipating reuse
  ("Production Orders/Dispatch later can reuse this instead of pulling in a second barcode library",
  `Barcode.tsx:12-16`) — and Dispatch later did exactly that, confirming the promotion was correct.
- `ToggleSwitch`/`ConfirmModal` were promoted specifically because the same Active/Inactive confirm-then-
  toggle flow was about to be duplicated across every master's list page (CLAUDE.md, Phase 3 extension
  notes) — a clear "this exact interaction will recur ~15 times" signal, not a guess.

**A currently-unresolved case that should be promoted, found during this audit**: `ActionButton` (a 3-variant
primary/secondary/danger button, used by every `*WorkflowPanel.tsx`) is defined **identically, byte-for-byte,
in 6 separate files**:
```
src/app/(dashboard)/sampling/SampleWorkflowPanel.tsx:1557-1587
src/app/(dashboard)/sales-orders/SalesOrderWorkflowPanel.tsx
src/app/(dashboard)/purchase-orders/PurchaseOrderWorkflowPanel.tsx
src/app/(dashboard)/material-requests/MaterialRequestWorkflowPanel.tsx
src/app/(dashboard)/production-orders/ProductionOrderWorkflowPanel.tsx (:496-526)
src/app/(dashboard)/buyer-enquiries/BuyerEnquiryWorkflowPanel.tsx
```
Confirmed identical via direct byte comparison of two of the six (`SampleWorkflowPanel.tsx:1557-1587` and
`ProductionOrderWorkflowPanel.tsx:496-526` — same signature, same `variantClass` ternary, same className
string, same JSDoc-free plain function). This is exactly the kind of "same need has now appeared far more
than twice" signal that already justified every existing promotion in this codebase (`ToggleSwitch`,
`ConfirmModal`, `Barcode`) — it has simply not been acted on yet for this one component. **Recommendation
(flagged, not fixed by this read-only audit): extract to `src/components/ui/ActionButton.tsx`** with the
exact existing prop shape (`label`, `onClick`, `isBusy`, `disabled?`, `variant?: "primary" | "secondary" |
"danger"`) and re-point all 6+ `*WorkflowPanel.tsx` files at the import — zero behavior change, pure
de-duplication, following the same reasoning that already promoted every other shared primitive in this
project.

**A second, smaller duplication found in the same family**: the status-badge color-map convention is
structurally identical across every module (`STATUS_LABELS`/`STATUS_BADGE_CLASS` pair) but the *export
name* varies — `STATUS_BADGE_CLASS` (`sales-orders/statusLabels.ts`, `sampling/statusLabels.ts`,
`buyer-enquiries`, `production-orders`, `purchase-orders`, `material-requests`), vs. `STATUS_STYLES`
(`accounts/sales-invoices`, `accounts/purchase-invoices`, `accounts/payments`, `accounts/journals`), vs.
`STATUS_BADGE_CLASSES` (`bom-mrp/[productId]/BomVersionPanel.tsx`), vs. `ACTION_BADGE_CLASSES`
(`admin/AdminAuditLogPanel.tsx`, a different concept — audit-log action verbs, not a document status, so a
different name there is legitimate). **This is real, minor naming drift for the otherwise-correctly-converged
badge pattern documented in `DESIGN_SYSTEM.md` § 1.** The color *values* and the `rounded-full px-2 py-0.5
text-xs font-medium` (table) / `px-3 py-1` (detail header) rendering shape are already consistent — only the
constant's name differs. **Recommendation**: standardize new modules on `STATUS_BADGE_CLASS` (the more
common of the two real variants, 6 files vs. 4) going forward; don't rename the existing 4 `STATUS_STYLES`
files purely for consistency (low value, real risk of an import-rename typo) unless one of them is being
touched for an unrelated reason anyway.

## 3. Cards

There is no dedicated `Card.tsx` primitive — every "card" is the same inline className pattern repeated
directly at the call site: `rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800
dark:bg-zinc-900` (KPI tiles, `dashboard/page.tsx:8`) or the `p-5`/`p-6` variants for modals/main content
(see `DESIGN_SYSTEM.md` § 3 spacing table). This is a real, if minor, gap — a dozen-plus files hand-repeat
this exact string. **Recommendation**: if a third or fourth genuinely card-shaped use case appears (beyond
KPI tiles and the workflow-panel "Actions" box, `SalesOrderWorkflowPanel.tsx:228`), promote a plain
`Card.tsx` wrapper (`className` passthrough, default padding `p-4`) — not urgent today since the existing
repetition is a single, stable className string rather than genuinely divergent styling.

## 4. Buttons

No shared `Button.tsx` exists (confirmed — CLAUDE.md's own "ground truth" section states this as a known
gap, and this audit's Grep confirms every button is still hand-rolled per file). Three real variants are in
consistent use, extracted here as the canonical spec (from `ActionButton`, § 2 above, and the plain form-
submit buttons):

| Variant | Classes | Use |
|---|---|---|
| **Primary** | `bg-indigo-600 text-white hover:bg-indigo-500` | Default action, form submit, "New X" links |
| **Secondary** | `border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800` | Cancel, Back, non-destructive secondary actions |
| **Danger** | `bg-red-600 text-white hover:bg-red-500` | Reject, Cancel-a-record, Deactivate (when rendered as a full button rather than a `ToggleSwitch`) |

Shared structural classes across all three: `rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50`
(toolbar-density buttons use `px-3 py-1.5` instead — see `DESIGN_SYSTEM.md` § 4 for the two-tier sizing
rule). Every button's `disabled` state is driven by an `isBusy || disabled` combination
(`ActionButton`'s exact shape) — always disable during an in-flight request, never allow a double-submit.

**Until `ActionButton` is promoted (§ 2), any new `*WorkflowPanel.tsx` should import it from an existing
sibling file's pattern rather than inventing a 7th near-identical copy** — or better, be the one that
finally does the promotion.

## 5. Forms

- **`FormField`** (`src/components/ui/FormField.tsx`) is the standard label+input wrapper: `label`,
  `htmlFor`, `required?`, `error?`, `children`. It renders the label, an optional red `*` for `required`,
  the input (as `children`, not owned by `FormField` itself — this is a composition wrapper, not an input
  component), and an optional error paragraph. **Always pass real `<input>`/`<select>`/`<textarea>` as
  children styled with the exported `textInputClass(hasError?)` helper** (`FormField.tsx:27-29`) — this is
  what keeps every input's border/focus-ring/dark-mode styling identical across the app without a dedicated
  `<Input>` component; don't hand-write a new input className string.
- **Required-field marking**: the red `*` appended to the label is the sole convention (`FormField.tsx:16`).
  Never use a different marker (asterisk color, position, or a trailing "(required)" string) in a new form.
- **Multi-column form layout**: no shared `FormGrid` exists — each larger form (`SalesOrderForm.tsx`,
  `PurchaseOrderForm.tsx`) wraps several `FormField`s in its own `grid grid-cols-1 sm:grid-cols-2 ...`
  wrapper. This is a minor, acceptable duplication (a two-line wrapper `<div>`, not real logic) — not worth
  promoting to a shared component per § 2's "promote only after genuine, non-trivial duplication" threshold.
- **Dual-mode create/edit forms**: the established shape (`SalesOrderForm.tsx`, `ExpenseForm.tsx`, and every
  other `*Form.tsx`) is one component accepting an optional `initial<Entity>` prop — present means edit mode
  (`PATCH`), absent means create mode (`POST`) — rather than two separate components. Follow this shape for
  any new module's form rather than writing a separate `NewXForm`/`EditXForm` pair.
- **Code-suggestion pattern**: for any lookup master with a `code` field, wire in `suggestCodeFromName()`
  (`src/lib/code-suggest.ts`, consumed by `SimpleLookupManager.tsx:124-127`) rather than leaving `code` a
  fully manual field — this is the established convention for every small master (Colors, Sizes, Brands,
  etc.), distinct from the sequential auto-numbering (`CUST-00001` style) used by identity-heavy masters
  (Customers/Suppliers/Employees/Styles/Materials) via `previewNextMasterCode()` (see CLAUDE.md, Phase 3
  extension notes, for the full split rationale — small mnemonic-code lookups vs. high-volume sequential
  masters).

## 6. Tables

### `DataTable` — the default, ~20+ modules

`src/components/ui/DataTable.tsx` is a generic paginated/searchable table. Its full contract:
```
fetchUrl: string                                  // GET {fetchUrl}?page=&search= → {data, meta}
columns: { key, header, render?(row) }[]
rowHref?(row): string                             // makes rows clickable + adds an "Edit" link + Enter-to-navigate
newHref?: string; newLabel?: string                // top-right "New" button
searchPlaceholder?: string
refreshKey?: number                                // bump to force an external refetch
rowActions?(row): ReactNode                        // extra per-row action(s) between Edit and the Active/Inactive toggle
```
- **The Active/Inactive `ToggleSwitch` column renders automatically** whenever a row object has an
  `isActive` boolean field (`DataTable.tsx:88,174,207-213`) — this is implicit, not opt-in. **Concrete
  gotcha, documented in CLAUDE.md's Phase 5B section**: if a list endpoint returns full master-data rows
  (which usually have `isActive`) for a page that has no matching `/status` PATCH route, `DataTable` will
  still render the toggle and 404 on click. **Always project a narrow DTO** (only the fields the page
  actually means to expose) from any list endpoint built on `DataTable`, rather than spreading a full model
  row — this is not a `DataTable` bug to route around, it's a contract the list endpoint must respect.
- **`rowActions`** was added specifically for a module-specific action that doesn't warrant its own column
  (per its own doc comment, `DataTable.tsx:24-31`) — e.g. Suppliers' "Categories"/"Materials" catalog buttons
  (`masters/suppliers/page.tsx:31-36`, rendering `SuppliedCategoriesSection`/`SuppliedMaterialsSection` as
  row-level buttons). Clicks inside `rowActions` never trigger the row's own navigate-on-click
  (`e.stopPropagation()` wrapper, `DataTable.tsx:203`) — any new `rowActions` content must be safe to nest
  inside a clickable `<tr>` without that same stopPropagation guard being re-derived per caller (it's already
  handled by `DataTable` itself).
- **When to use `DataTable` vs. a custom worklist table**: default to `DataTable` for any master or simple
  transactional list. Build a bespoke table only when a page needs genuine server-side multi-field
  filtering/sorting beyond a single search box — the one real precedent is Sampling's own worklist
  (`src/app/(dashboard)/sampling/page.tsx`), deliberately **not** merged into `DataTable` per CLAUDE.md's
  2026-08-19 note, specifically to avoid regressing the ~20 other modules that rely on `DataTable`'s simple
  shape. If you build a second bespoke worklist table, replicate Sampling's sortable-column-header +
  Prev/Next + "N results found" shape rather than inventing a third table pattern.

### `SimpleLookupManager` — small, low-churn masters

`src/components/ui/SimpleLookupManager.tsx` is a single-page list+inline-form manager (no separate
new/edit routes) for small lookup tables (Colors, Sizes, Departments, etc.) — `fields` (with `text`/
`number`/`color`/`date`/`select` types, the `select` type supporting either static `options` or an async
`optionsUrl`), `displayColumns?`, `hasActiveToggle?`, `codePrefix?`. **Use this instead of a full
list/new/[id] CRUD stack whenever the master is genuinely small and low-churn** (per CLAUDE.md's Phase 3
scope note) — this is a density choice already made deliberately for ~15 masters, not a shortcut to avoid
repeating for a master that actually needs real create/edit pages (e.g. Customers, Products).

### `ReportTable` — reports only

`src/components/reports/ReportTable.tsx` is a third, report-specific table (typed columns with
`align`/`type: "date"|"currency"|"percent"|"number"` formatting, an optional `totals` footer row, optional
per-column `linkBuilders` for drill-down). Not paginated (see `UI_RULES.md` § 2). Do not repurpose this for
a non-report list page — its currency/percent auto-formatting and lack of pagination are report-specific
design choices.

## 7. Reusable-Component Rules

- **Props-first design**: every shared component in `src/components/ui/` takes plain data + callback props
  and owns zero implicit global state — `DataTable`/`SimpleLookupManager` each manage their own fetch
  lifecycle internally but are fully parameterized by `fetchUrl`, not hardcoded to one module. Any new
  shared component should follow this same shape: no module-specific logic baked in, only configuration
  passed down.
- **Self-fetch-on-open pattern** (for a Section/Modal that shows a parent record's related data): don't
  fetch on mount for every visible row/section — fetch only when the user actually opens it. Reference
  implementation: `SuppliedMaterialsSection.tsx:62-70` (`openModal()` fires `Promise.all([...])` only inside
  the click handler that sets `open` to `true`) — its own doc comment states the reasoning explicitly:
  "fetched only when the modal opens, not on mount — a list row has no per-row detail fetch to piggyback on,
  and fetching this for every visible row up front would be an unnecessary N+1 read most rows never open"
  (`SuppliedMaterialsSection.tsx:47-50`). Apply this same lazy-fetch-on-open shape to any future per-row
  detail modal/section rather than eagerly fetching for every row in a list.
- **`key`-prop-on-navigation-remount rule** (documented at length in CLAUDE.md, "Phase 4 bugfix — stale
  sample data after client-side navigation," 2026-08-19): any Server Component detail page that hands
  server-fetched data to a stateful Client Component (a `*Form` with `useState(initialValues)`, or a
  `*Section`/`*WorkflowPanel` with `useState(initialX)`) **must** pass `key={id}` on that component — Next.js
  App Router does not remount a Client Component just because a prop changed during client-side navigation,
  and `useState`'s initializer only runs on first mount. Reference implementation:
  `sales-orders/[id]/page.tsx:37` (`<SalesOrderWorkflowPanel key={id} ... />`, with the exact same rationale
  restated inline). **If a page renders two or more keyed siblings that each independently need this fix**
  (e.g. a `*Form` next to a `*Section`), each sibling's key must be distinguished with a prefix
  (`key={\`form-${id}\`}`, `key={\`variants-${id}\`}`) — React scopes key uniqueness to sibling position, not
  per-component-type, so two siblings both using the bare `key={id}` throws a real "two children with the
  same key" console error. This exact pattern (three keyed siblings: form + two `*Section`s) is used on
  `masters/suppliers/[id]/page.tsx` (`SupplierForm`, `SuppliedMaterialsSection`, `SuppliedCategoriesSection`)
  per CLAUDE.md's 2026-08-31 entry — follow that file's exact prefixing shape for any future 3-plus-sibling
  detail page.
- **Decimal/Date serialization across the Server→Client boundary**: any Prisma query result containing a
  `Decimal` or `DateTime` field passed from a Server Component page into a Client Component prop must be
  round-tripped through `JSON.parse(JSON.stringify(row))` first (`sales-orders/[id]/page.tsx:37`'s inline
  comment explains why: `Decimal` instances aren't plain-serializable, and a raw `Date` fails the same way).
  Apply this on every new detail page built on the "Server Component + Client Component panel" split.

## 8. The "Server Component page + Client Component panel" Split (structural rule, not just a component rule)

Every detail page in this app follows one shape, and it should not be flattened for a new module: a
`page.tsx` Server Component fetches data directly via the module's own service function (no internal fetch
round-trip — `getSalesOrderById(session!.user.companyId, id)`, `sales-orders/[id]/page.tsx:12`), calls
`notFound()` if missing, renders the page chrome (`Breadcrumb`, `<h1>`, optional `Barcode`), and passes the
serialized record into exactly one keyed Client Component (`*WorkflowPanel`) that owns all interactive state.
**List pages are increasingly following the same split for a different reason** (permission-gating, see
below) — a thin `page.tsx` Server Component doing an early `PermissionService.assert(...).catch(() =>
notFound())` check, rendering a sibling `*ListClient.tsx` that owns the actual `DataTable`
(`accounts/journals/page.tsx` + `JournalsListClient.tsx`, `accounts/payments/` + `PaymentsListClient.tsx`,
`accounts/expenses/` + its own list client — all three added in the Phase 10 QA pass per CLAUDE.md).

**A real, currently-unresolved inconsistency, disclosed rather than hidden**: only these 3 financial list
pages have this server-side permission gate; CLAUDE.md's own Phase 10 section states plainly that **~47 more
client list pages share the old, ungated pattern** (a bare `"use client"` `page.tsx` rendering `DataTable`
directly with no `PermissionService.assert` of its own — e.g. `sales-orders/page.tsx` in this audit's own
evidence). This is not a security hole (the underlying API routes still 403 correctly) but is a real,
acknowledged UI-polish/defense-in-depth gap — CLAUDE.md explicitly recommends "a dedicated follow-up sweep
rather than a rushed pass across 47 files." **Any new list page should be built with the gated
`page.tsx`-Server-Component + `*ListClient.tsx` split from the start**, matching the 3 newest examples, not
the older 47-file majority pattern — the newer pattern is the one to converge toward, even though it isn't
yet the numerically dominant one.
