# Fashion ERP — Design System

This document captures the **visual foundations actually in use** in the codebase today, converges the
handful of real inconsistencies found into one standard, and states concrete recommendations for genuine
gaps. It is evidence-based: every rule below cites at least one real file. See `UI_RULES.md` for behavioral/
interaction rules and `COMPONENT_GUIDELINES.md` for component-level rules.

There is **no `tailwind.config.*` file** (Tailwind v4 CSS-first config) and **no semantic color/spacing/
radius token layer** — `src/app/globals.css` defines exactly two tokens (`--background`, `--foreground`) plus
font variables. Every rule in this document is therefore a *convention enforced by repetition across files*,
not a config-enforced token. That is itself the single biggest structural gap in the design system (see
"Recommended: introduce real design tokens" at the end).

## 1. Color System

There is no `--color-primary`/`--color-success`/etc. token anywhere. The "palette" is a set of Tailwind
color families used consistently by convention. Evidence gathered via Grep across `src/components/ui/` and
`src/app/(dashboard)/`.

| Semantic role | Light | Dark | Evidence |
|---|---|---|---|
| Page canvas | `bg-zinc-50` | `dark:bg-zinc-950` | `src/app/(dashboard)/layout.tsx:25` (`<main>`) |
| Card / panel / table surface | `bg-white` | `dark:bg-zinc-900` | `src/components/ui/DataTable.tsx:131`, `Modal.tsx:56` |
| Card / surface border | `border-zinc-200` | `dark:border-zinc-800` | same files |
| Primary text | `text-zinc-900` | `dark:text-zinc-50` | `DataTable` has no `<h1>`, but every page header, e.g. `src/app/(dashboard)/sales-orders/page.tsx:26` |
| Secondary/muted text | `text-zinc-500` / `text-zinc-600` | `dark:text-zinc-400` | `FormField.tsx:14` labels use `text-zinc-700`; helper/description text uses `text-zinc-500`, e.g. `sales-orders/page.tsx:27` |
| Table body text | `text-zinc-700` | `dark:text-zinc-200` | `DataTable.tsx:170` |
| Disabled/subtle border (inputs) | `border-zinc-300` | `dark:border-zinc-700` | `FormField.tsx:25` |
| **Primary action** (brand) | `bg-indigo-600` / `text-indigo-600` | `hover:bg-indigo-500` (same in dark) | `DataTable.tsx:124` "New" button, `ConfirmModal.tsx:60` confirm button, 49 files match `bg-indigo-600 px-4 py-2` (Grep count) |
| Primary focus ring | `focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500` | same | `FormField.tsx:25`, `DataTable.tsx:119` |
| **Danger / destructive** | `bg-red-600 text-white hover:bg-red-500` | same | `ConfirmModal.tsx:60-61` (`isDangerous`), `ActionButton`'s `variant="danger"` (`SampleWorkflowPanel.tsx:1573-1574`, duplicated in 5 more files — see `COMPONENT_GUIDELINES.md`) |
| Danger text / inline error | `text-red-600` | `dark:text-red-400` | `DataTable.tsx:146-147`, `FormField.tsx:19`, every form's inline `{error && <p className="text-sm text-red-600...">}` |
| **Success** | `bg-green-500` (toggle "on"), `text-green-700`/`bg-green-100` (badges) | `dark:text-green-300`/`dark:bg-green-500/10` | `ToggleSwitch.tsx:25`, `sales-orders/statusLabels.ts:19-20` (`INVOICED`/`CLOSED`) |
| **Warning** | `bg-amber-100 text-amber-700` | `dark:bg-amber-500/10 dark:text-amber-300` | `sampling/statusLabels.ts:20-21,24` (`IN_DEVELOPMENT`, `REVISION_REQUESTED`), `ReportPage.tsx:140` (`unavailableReason` banner: `border-amber-300 bg-amber-50 ... dark:bg-amber-950/30`) |
| **Info** | `bg-blue-100 text-blue-700` | `dark:bg-blue-500/10 dark:text-blue-300` | `sales-orders/statusLabels.ts:15` (`CONFIRMED`), `sampling/statusLabels.ts:18-19` (`REQUESTED`, `TECH_PACK_READY`) |
| Neutral/idle state (Draft, On Hold) | `bg-zinc-100`/`bg-zinc-200 text-zinc-700` | `dark:bg-zinc-800`/`dark:bg-zinc-700` | `sales-orders/statusLabels.ts:14,21` |
| Terminal/cancelled | `bg-zinc-200 text-zinc-500 ... line-through` | `dark:bg-zinc-700 dark:text-zinc-400` | `sales-orders/statusLabels.ts:22`, identical in `sampling/statusLabels.ts:28` |

**Standard color role → Tailwind mapping (converged, use this going forward):**
- Primary / brand / default call-to-action → `indigo-600` (bg) / `indigo-500` (hover) / `indigo-600` (text links)
- Danger / destructive / reject → `red-600` (bg) / `red-500` (hover), `red-600`/`red-400` (text)
- Success / positive terminal state → `green-*` (badges use the light `-100`/`dark:-500/10` pill treatment, never a solid `bg-green-600` button — this app has no "success button," only a success *badge*)
- Warning / in-progress / needs attention → `amber-*`
- Info / early-stage / neutral-positive → `blue-*`
- Neutral / structural chrome (borders, muted text, disabled, draft) → `zinc-*` (the only neutral family used — no `gray-*` or `slate-*` anywhere, confirmed by Grep)

**Status badge color convention** (converged from `deals/statusLabels.ts`, `sales-orders/statusLabels.ts`,
`sampling/statusLabels.ts`, `production-orders/statusLabels.ts`, `purchase-orders/statusLabels.ts`,
`material-requests/statusLabels.ts`, `buyer-enquiries/statusLabels.ts`, `campaigns/statusLabels.ts`,
`leads/statusLabels.ts` — 9 files, all structurally identical): a draft/idle status is `zinc`, an early/
submitted status is `blue`, an in-progress/needs-decision status is `amber`, a resulting/downstream status
is `indigo`, a successful terminal status is `green`, a failed/rejected terminal status is `red`, and
`CANCELLED` is always `zinc-200`/`zinc-700` (light) with `line-through` regardless of module. **This is
already a converged, well-applied pattern — the only inconsistency is naming** (see `COMPONENT_GUIDELINES.md`
§ Badges).

**Dark mode strategy**: `prefers-color-scheme: dark` media query only (`globals.css:15-20`), via Tailwind's
`dark:` variant on every component. **There is no user-facing theme toggle and no `next-themes`/class-based
override anywhere in the codebase** (confirmed: zero matches for `next-themes`, no `class="dark"` toggle
logic). The OS/browser setting is the only control. This is a real, confirmed gap if a manual toggle is ever
wanted — not a bug, just an absent feature.

**Contrast notes**: zinc-500-on-white (`#71717a` on `#fff`) is ~4.6:1, passing AA for normal text; zinc-400
(used for the lightest meta text, e.g. `ReportPage.tsx:155` "Generated…" caption) is ~3:1 against white —
**borderline, fails AA for normal-size text**, acceptable only because it is always used for genuinely
secondary/tertiary caption text, never a primary label. Badge text (`indigo-700`/`amber-700`/`green-700` on
their own `-100` background) comfortably passes AA. Recommendation: avoid introducing `text-zinc-400` for
anything above "timestamp/caption" significance; if a future accessibility pass is done, `text-zinc-500` should
be the floor for standalone body text.

## 2. Typography

No named type scale exists in config — this table is the de facto scale, extracted from actual usage.

| Use | Classes | Evidence |
|---|---|---|
| Page/section title (`<h1>`) | `text-lg font-semibold text-zinc-900 dark:text-zinc-50` | `sales-orders/page.tsx:26`, `ReportPage.tsx:84`, `dashboard/page.tsx:29` — this exact string appears on effectively every list/detail page |
| Page description (under h1) | `mt-1 text-sm text-zinc-500 dark:text-zinc-400` | `sales-orders/page.tsx:27-29` |
| Modal/dialog title (`<h2>`) | `text-base font-semibold text-zinc-900 dark:text-zinc-50` | `Modal.tsx:60-62`, `ConfirmModal.tsx:41-43` |
| Section sub-heading inside a panel | `text-sm font-semibold text-zinc-900 dark:text-zinc-50` | `SalesOrderWorkflowPanel.tsx:229` ("Actions") |
| Form field label | `text-sm font-medium text-zinc-700 dark:text-zinc-300` | `FormField.tsx:14` |
| Small/inline field label (filter panels, inline lookup forms) | `text-xs font-medium text-zinc-500/zinc-600` | `SamplingFilters.tsx:137`, `SimpleLookupManager.tsx:191` |
| Body / table text | `text-sm` | `DataTable.tsx:132,170` |
| Table header | `text-xs font-medium uppercase tracking-wide text-zinc-500` | `DataTable.tsx:134-138` |
| Meta/caption/timestamp | `text-xs text-zinc-400` | `ReportPage.tsx:155`, `Breadcrumb.tsx:15` (separator) |
| Badge/pill text | `text-xs font-medium` | every `statusLabels.ts` consumer, e.g. `SampleWorkflowPanel.tsx:622` |
| KPI/dashboard tile number | `text-2xl font-semibold` | `dashboard/page.tsx:9` (`StatTiles`) |
| Login/auth page title | `text-xl font-semibold` | `login/page.tsx:51` (the one place a size between the normal h1 and the KPI number appears — a deliberately slightly larger, standalone-page heading) |
| Error/validation text | `text-sm text-red-600 dark:text-red-400` (body-level) or `text-xs text-red-600 dark:text-red-400` (field-level, under an input) | `SalesOrderWorkflowPanel.tsx:226` vs `FormField.tsx:19` |

**Heading hierarchy is intentionally shallow**: this app almost never goes past `<h1>` (page title, `text-lg`)
→ `<h2>`/plain `<div>` (section heading, `text-sm font-semibold`) → labels. There is no `text-3xl`/`text-4xl`
hero-style heading anywhere in the dashboard shell (only 6 files use `text-xl`/`text-2xl` at all, all either
the login screen or a KPI number — see Grep evidence). This is correct for a dense enterprise UI and should
remain the standard — **do not introduce a larger page-title size**; if a report or dashboard needs more
visual weight, use a KPI tile (`text-2xl`) inside the body, not a bigger `<h1>`.

**Font family**: `next/font/google` loads Geist Sans/Mono and registers them as `--font-geist-sans`/
`--font-geist-mono` → `@theme inline`'s `--font-sans`/`--font-mono` (`globals.css:8-13`), and `layout.tsx:25`
applies both font-variable classes to `<html>`. **However, `globals.css:25` hardcodes `body { font-family:
Arial, Helvetica, sans-serif; }` directly, and no `font-sans` utility class is ever applied anywhere
(confirmed by Grep — zero matches for `font-sans` outside `globals.css` itself).** The plain CSS rule on
`body` wins, so **the app's real, currently-rendered font is Arial/Helvetica, not Geist** — the Geist setup is
dead configuration. This is a genuine, verifiable inconsistency between intent and result, not a matter of
opinion. **Recommendation**: either delete the unused Geist font loading/variables (if Arial is the intended
look) or delete the `body { font-family: ... }` override and add `className="font-sans"` to `<body>` in
`layout.tsx` (if Geist was actually intended) — pick one, don't leave both half-wired.

## 3. Spacing Scale

No custom spacing tokens — plain Tailwind spacing scale, used with a clear per-context convention:

| Context | Values | Evidence |
|---|---|---|
| Page-level vertical rhythm (`space-y-*` on the outermost page wrapper) | `space-y-4` (list pages) or `space-y-6` (detail pages, dashboards) | `sales-orders/page.tsx:22` vs `sales-orders/[id]/page.tsx:16` |
| Panel-internal vertical rhythm | `space-y-3` or `space-y-4` | `DataTable.tsx:109`, `SamplingFilters.tsx:134` |
| Between a workflow panel's major sections | `space-y-8` | `SampleWorkflowPanel.tsx:620`, `SalesOrderWorkflowPanel.tsx` (`<div className="space-y-8">`) |
| Inline horizontal control groups (buttons, badges next to text) | `gap-2` or `gap-3` | `Topbar.tsx:30` (`gap-4`), `DataTable.tsx:194` (`gap-3`), `ConfirmModal.tsx:46` (`gap-3`) |
| Card/container internal padding | `p-4` (dense) or `p-5` (modal) or `p-6` (page-level `<main>`/login card `p-8`) | `dashboard/page.tsx:8` tile `p-4`; `Modal.tsx:56` `p-5`; `layout.tsx:25` `<main>` `p-6`; `login/page.tsx:50` `p-8` |
| Table cell padding | `px-4 py-2` (body rows) | `DataTable.tsx:136,170` — universal across `DataTable`, `SimpleLookupManager`, report tables use the slightly denser `px-3 py-2` (`ReportTable.tsx:40,59`) |
| Button padding | `px-3 py-1.5` (compact, in-table/toolbar buttons) or `px-3 py-2`/`px-4 py-2` (primary form-level buttons) | see § 4 below — this is the one area with real, if minor, variance |
| Input padding | `px-3 py-2` | `FormField.tsx:25` (form inputs), vs `px-3 py-1.5` for the DataTable search box (`DataTable.tsx:119`) and Topbar search (`Topbar.tsx:27`) — **deliberate**: standalone form fields get the larger `py-2`, inline/toolbar search fields get the more compact `py-1.5` |

**Standard**: page wrapper spacing is `space-y-4` for list pages, `space-y-6` for detail/dashboard pages;
panel-internal spacing is `space-y-3`–`space-y-4`; a workflow panel's own major section breaks use `space-y-8`.
Follow whichever of these three tiers matches the page you're building — don't invent a fourth value.

## 4. Buttons — sizing variance (real inconsistency, resolved)

Two real button-padding conventions coexist, both legitimate for different contexts, but not documented
until now:
- **Compact/toolbar button**: `rounded-md ... px-3 py-1.5 text-sm font-medium` — used for in-page toolbar
  actions (`DataTable.tsx:124` "New" link, `ReportPage.tsx:104` "Refresh"/export buttons, `Modal`-triggering
  buttons throughout `*WorkflowPanel.tsx` files).
- **Form-submit button**: `rounded-md ... px-4 py-2 text-sm font-medium` (sometimes `font-semibold` on the
  login page specifically, `login/page.tsx:90`) — used for the primary submit action at the bottom of a full
  page-level form (49 files match this exact string per Grep, e.g. `SalesOrderForm.tsx`, `CustomerForm.tsx`,
  `ExpenseForm.tsx`).

**This is not an accidental inconsistency — it's a real, defensible two-tier system already followed
consistently**: a toolbar/inline action button is `py-1.5`; a page-level form's primary submit button is
`py-2`. **Converged standard**: keep both tiers exactly as-is; do not collapse them into one size. See
`COMPONENT_GUIDELINES.md` § Buttons for the full variant matrix (primary/secondary/danger) and the
`ActionButton` duplication finding.

## 5. Radius Scale

- `rounded-md` (6px) — default for buttons, inputs, small containers, filter panels. This is the single most
  common radius in the codebase (11+ occurrences in shared components alone, effectively universal in forms).
- `rounded-lg` (8px) — reserved for larger structural containers: table wrappers (`DataTable.tsx:131`), modal
  cards (`Modal.tsx:56`, `ConfirmModal.tsx:38`), KPI tiles (`dashboard/page.tsx:8`), report tables
  (`ReportTable.tsx:33`).
- `rounded-full` — pills/badges (`rounded-full px-2 py-0.5 text-xs font-medium` for table-row badges,
  `rounded-full px-3 py-1 text-xs font-medium` for a detail-page header's larger status badge — see
  `SampleWorkflowPanel.tsx:622` vs `sampling/page.tsx:215`) and the `ToggleSwitch` track/thumb
  (`ToggleSwitch.tsx:24,29`).

**Standard**: `rounded-md` for controls, `rounded-lg` for containers one level up (cards/tables/modals),
`rounded-full` exclusively for badges and toggles. Never use `rounded-xl`/`rounded-2xl`/`rounded-sm`/no
radius — none appear anywhere in the codebase; introducing them would break the existing visual rhythm.

## 6. Grid / Layout Conventions

- **No max-width container anywhere in the dashboard shell.** `<main>` (`layout.tsx:25`) is `flex-1
  overflow-y-auto bg-zinc-50 p-6 dark:bg-zinc-950` with no `max-w-*`/`mx-auto` — pages render edge-to-edge
  within the sidebar+topbar frame. This is intentional for an information-dense ERP (per this project's own
  "Information Density" principle) — **do not add a centered `max-w-7xl mx-auto` wrapper to a page**; it
  would be inconsistent with every existing page.
- **Sidebar is a fixed `w-64` (`Sidebar.tsx:83`), non-collapsible, with no responsive breakpoint of its own**
  — confirmed by Grep: zero `md:hidden`/`lg:hidden`/hamburger-toggle logic exists anywhere in
  `src/components/layout/`. This is a **genuine, unaddressed gap** against the project's own stated tablet/
  mobile targets (768px and below) — see `UI_RULES.md` § Responsive Behavior for the concrete recommendation.
- **Two responsive breakpoints in practical use**: `sm:` and `lg:` (rarely `md:`). Grep across
  `src/app/(dashboard)/` found exactly 5 files using a `grid-cols-1 sm:grid-cols-2 ... lg:grid-cols-3`-shaped
  responsive grid (`SamplingFilters.tsx:135`, `reports/page.tsx`, `accounts/page.tsx`, `masters/page.tsx`,
  `marketing/page.tsx`) and the dashboard's own `StatTiles` uses `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`
  (`dashboard/page.tsx:6`). **Standard breakpoint pattern for a card/tile grid**: `grid-cols-1
  sm:grid-cols-2 lg:grid-cols-3` for filter/form field grids, `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` (or
  similar) for KPI tile rows. `md:` is not part of this app's practical breakpoint vocabulary today — don't
  introduce it without reason.
- **Forms are single-column by default** (`FormField` stacks label-over-input, one per row) with occasional
  multi-column layouts via a manual `grid grid-cols-2 gap-3`-style wrapper around several `FormField`s in the
  larger transactional forms (e.g. `SalesOrderForm.tsx`, `PurchaseOrderForm.tsx`) — there is no shared
  `FormGrid`/`FormRow` component; each form hand-rolls its own grid wrapper. This is a minor duplication (not
  severe enough to require a new shared primitive) — see `COMPONENT_GUIDELINES.md` for the reuse-vs-local
  guidance that applies here.

## 7. Iconography

**No icon library is installed** — confirmed via `package.json` (no `lucide-react`, `heroicons`,
`react-icons`, or `@tabler/icons` dependency) and via Grep (zero imports of any such package anywhere in
`src/`). Icons today are three things, used inconsistently by necessity rather than choice:
1. **Unicode/emoji glyphs** inline in JSX: `✕` (close, `Modal.tsx:69`, `FilePreviewModal.tsx:95`), `⟲`/`⟳`
   (rotate, `FilePreviewModal.tsx:73,76`), `▲`/`▼` (expand/collapse, `SamplingFilters.tsx:130`), `←`/`→`
   (back/forward, `Topbar.tsx:37`, `CsvImportModal.tsx:196,204`).
2. **One hand-rolled inline `<svg>`**: the sidebar's `ChevronIcon` (`Sidebar.tsx:20-31`), a single 20×20
   path-based chevron used for nav-group expand/collapse.
3. **`jsbarcode`** (a real dependency) for the one legitimate barcode-rendering need (`Barcode.tsx`).

There is no consistent tap-target-sized icon-button component — icon-ish buttons (`ToolbarButton` in
`FilePreviewModal.tsx:129-141`) are text/glyph buttons styled like any other small button, not true icons.

**Recommendation**: this is a genuine, currently-unaddressed gap for a UI this data-dense (row actions, table
sort indicators, and future "More actions" menus described in the Table-First Rule all benefit from real
icons rather than glyphs). If/when icons are introduced, adopt a single lightweight, tree-shakeable library
(`lucide-react` is the natural fit — MIT-licensed, zero runtime CSS, matches the existing minimal-dependency
philosophy already shown by choosing `jsbarcode` over a heavier alternative) rather than continuing to expand
the unicode-glyph approach, and replace the sidebar's hand-rolled `ChevronIcon` with the library's own
chevron for consistency once adopted. Do not adopt this speculatively — it is a recommendation for the next
UI pass, not a retrofit to do today unprompted.

## 8. Accessibility — Color & Contrast Notes

- Every interactive control that has a visible focus state uses `focus:outline-none focus:ring-1
  focus:ring-indigo-500` (inputs, `FormField.tsx:25`) or `focus:ring-2 focus:ring-indigo-500
  focus:ring-offset-1` (the one exception, `ToggleSwitch.tsx:24`, which needs a stronger ring since its own
  visual affordance is small). **Standard**: `focus:ring-1 focus:ring-indigo-500` for text inputs/selects,
  `focus:ring-2 ... focus:ring-offset-1` for small/icon-sized controls where a 1px ring would be hard to see.
- Status is **never communicated by color alone** in the badge system — every badge also carries its own text
  label (`STATUS_LABELS[status]`), and `CANCELLED` additionally gets `line-through` as a second, non-color
  signal (`sales-orders/statusLabels.ts:22`). This is a correctly-applied pattern; preserve it for any new
  status enum.
- See `UI_RULES.md` § Accessibility Rules for the behavioral/ARIA side of this (dialog roles, live regions,
  keyboard nav) — this section is colors/contrast only.

## 9. Recommended: introduce real design tokens (gap, not yet done)

Because there is no `tailwind.config.*` and no `@theme` beyond `--background`/`--foreground`, every rule
above is enforced by convention/copy-paste, not by a shared token a linter or type system can check. A
future hardening pass should consider adding semantic `@theme` tokens (e.g. `--color-danger`,
`--color-success`, `--radius-control`, `--radius-container`) that map to the exact values documented above,
so `bg-indigo-600`/`bg-red-600`/etc. become `bg-danger`/`bg-primary` — purely a refactor of *what backs* the
same visual values, not a redesign. This is explicitly a recommendation, not something this audit changes.
