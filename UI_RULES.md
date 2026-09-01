# Fashion ERP — UI Behavioral & Interaction Rules

Cross-module rules for how things *behave*, as opposed to how they look (`DESIGN_SYSTEM.md`) or how
components are structured (`COMPONENT_GUIDELINES.md`). Every rule cites real evidence. Where CLAUDE.md
already documents the rationale for a convention, this file cites and reuses that rationale rather than
re-deriving it.

## 1. Filters & Search

Two real, both-legitimate patterns exist, scoped by table complexity:

- **Simple list pages** (`DataTable`-backed, ~20+ modules): a single debounced free-text search box, no
  separate filter panel. `DataTable.tsx:59-86` debounces on a 250ms `setTimeout` + `AbortController`, resets
  to page 1 on every keystroke (`onChange` handler, `DataTable.tsx:115-118`). This is the default for any
  master or simple transactional list — **do not build a filter panel for a list that only needs a search
  box**.
- **Worklist pages with real multi-field filtering** (Sampling is the reference implementation): a
  collapsible panel below the page header, closed by default, showing `Filters` or `Filters (N)` where N is
  the count of currently-*applied* (not draft) filters (`SamplingFilters.tsx:111,127-129`). Filters are
  staged in local `draft` state and only take effect on an explicit "Apply Filters" click — never live-filter
  as the user types in this panel (contrast with the simple search box above, which *is* live/debounced).
  Date-range filters get `Today`/`This Week`/`This Month` presets alongside free typing
  (`SamplingFilters.tsx:58-72`) — always compute preset boundaries from **local calendar components**, never
  `.toISOString()` (which converts through UTC and lands a day early on IST) — this exact bug was found and
  fixed three separate times per CLAUDE.md (Executive Dashboard, Daily Attendance, then again in three
  client-side files including this one) — see CLAUDE.md's "Phase 10" and "P2-P4 fix pass" sections. Any new
  date-preset code must read local `Date` components directly, matching `toIsoDate()` in
  `SamplingFilters.tsx:51-56`.
  A "Clear All" action must reset the *draft* without collapsing the panel — CLAUDE.md documents a real bug
  where remounting the filter component via `key` on Clear All also reset the panel's own open/closed state;
  the fix was lifting `isOpen`/`onToggleOpen` to the parent page as controlled props, which is now the
  standard shape (`SamplingFilters.tsx:78-86`).
- **When to build a new worklist-style filter panel vs. reuse `DataTable`'s search box**: only when a module
  genuinely needs multi-field/status/date-range filtering with server-side query params — this is a page-
  level investment (a purpose-built table, not `DataTable`), not a component to reach for by default. Per
  CLAUDE.md, this was deliberately *not* folded into the shared `DataTable` "to avoid regressing the ~20
  modules that use it as a plain list" — reuse that reasoning before building a second one.

## 2. Pagination

Exactly one pattern app-wide: `DataTable.tsx:224-247`.
- Footer text: `Showing {from}–{to} of {totalCount}` (only rendered when `totalCount > 0`).
- `Prev`/`Next` text buttons, `rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40` — disabled at
  the natural boundaries (`page <= 1`, `page >= totalPages`), never hidden.
- No page-size selector, no jump-to-page input, no numbered page links anywhere in the codebase (confirmed —
  `DataTable` is the sole pagination implementation used by every list page). **This is the standard — do not
  add page-number links or a page-size selector to an individual page**; if page-size configurability is ever
  needed, it belongs as a `DataTable` prop change (affecting all consumers at once), not a per-page override.
- Report tables (`ReportTable.tsx`) are **not** paginated at all — they render every row up to
  `EXPORT_ROW_CAP_EXCEL`/PDF's own row caps and rely on filters to narrow the set; this is a deliberate,
  documented difference (reports are meant to be exported/printed as a whole), not an oversight.

## 3. Dialog / Modal Behavior

Two distinct dialog primitives, each with its own contract — use the right one, don't blend them:

- **`Modal`** (`src/components/ui/Modal.tsx`): generic container for arbitrary form content. Closes on: the
  ✕ button, `Escape` (window-level listener, `Modal.tsx:36-43`), and backdrop click — **unless** the caller
  passes `closeOnBackdropClick={false}`, which keeps ✕/Escape working but disables the backdrop shortcut.
  This opt-out exists for exactly one documented reason: a dialog whose entire content is one just-typed,
  not-yet-submitted value where an accidental outside click would discard real work (the Reset Password
  modal, per CLAUDE.md's 2026-08-29 entry) — **use this opt-out sparingly, only for that same class of
  "would discard freshly-typed, high-cost-to-retype input" case**, not as a general "make my modal stickier"
  toggle. `role="dialog" aria-modal="true" aria-labelledby="modal-title"` are always present
  (`Modal.tsx:50-52`).
- **`ConfirmModal`** (`src/components/ui/ConfirmModal.tsx`): a fixed confirm/cancel button pair, always
  backdrop-closable (calls `onCancel` on backdrop click, no opt-out — a confirm/cancel dialog has no typed
  input to lose). `isDangerous` swaps the confirm button to red (`bg-red-600`); `isBusy` disables both
  buttons and relabels the confirm button "Please wait…" (`ConfirmModal.tsx:63`). **Use `ConfirmModal` for
  any destructive or state-changing yes/no decision** (deactivate, delete, cancel, approve/reject) —
  `DataTable`'s own Active/Inactive toggle routes through it (`DataTable.tsx:249-262`), and it should be the
  default reach for any new confirm-style action rather than a bespoke inline `confirm()`-style prompt.
- **When to use a Modal vs. a full page**: per CLAUDE.md's explicitly-stated UX rule (repeated verbatim
  here because it is foundational, not merely a convention): *small, focused CRUD actions (add/edit a line
  item, record a decision, post a comment) use `Modal`/`ConfirmModal`; record creation, the main workflow/
  detail panel, and any timeline/history view are full pages — not modals.* This distinction is deliberate
  and must be preserved on any new module (do not "modal-ify" a creation flow or a detail page just because
  a Modal is available).
- **Remount-on-open, not reset-in-effect**: any stateful modal content (zoom/rotation in `FilePreviewModal`,
  a multi-step import wizard in `CsvImportModal`) resets by the caller passing a changing `key` prop
  (`FilePreviewModal.tsx:27-29` documents this explicitly; `CsvImportModal.tsx:30-35` requires the same),
  **never** a `useEffect` that calls `setState` when `open` becomes true — that pattern trips this project's
  `react-hooks/set-state-in-effect` lint rule and has caused real, documented bugs (CLAUDE.md, Sampling
  worklist filters section). Follow the `key`-remount convention for any new stateful modal/section.

## 4. Toast / Inline Feedback

**There is no toast/snackbar library or mechanism anywhere in this codebase** — confirmed via `package.json`
(no `react-hot-toast`/`sonner`/`react-toastify`) and via Grep (zero references). Feedback today is:
- **Success**: implicit — a modal closes and the underlying list/table reloads (`SimpleLookupManager.tsx:
  154-155`, `load()` after a successful submit; `DataTable`'s own `reloadTick` counter,
  `DataTable.tsx:57,105`). There is **no** explicit "Saved successfully" message anywhere for these flows —
  the closed modal + refreshed list *is* the confirmation.
- **Error**: an inline `<p className="text-sm text-red-600 dark:text-red-400">{error}</p>` directly under
  the form/action that failed (`SalesOrderWorkflowPanel.tsx:226`, `SimpleLookupManager.tsx:234`,
  `login/page.tsx:85`) — never an alert(), never a toast. The message comes straight from the API's
  structured error body: `body?.error?.message ?? "<generic fallback>"` (`DataTable.tsx:71`,
  `SimpleLookupManager.tsx:150`) — this is the `BusinessRuleError`-to-UI convention: the backend's
  `{ error: { code, message, details } }` shape (documented in CLAUDE.md's API Architecture section) is
  always unwrapped to its `.message` for direct display; the `code`/`details` fields exist for programmatic
  handling (e.g. the Material Request module's `DUPLICATE_MATERIAL_REQUEST_EXISTS` override-with-a-button
  flow) but the plain message is always what a user sees.
- **Legacy anti-pattern still present in 2 files**: `window.location.reload()` (`CampaignWorkflowPanel.tsx`,
  `DealWorkflowPanel.tsx`, 7 occurrences total) as a blunt "refresh everything" mechanism, predating the
  `reloadTick`/`refreshKey` counter convention used everywhere else. **Do not copy this pattern into new
  code** — use a local reload/refetch function or a bumped counter prop instead, matching
  `DataTable`/`SimpleLookupManager`'s own convention; a full page reload discards all client state (scroll
  position, any other in-progress edits) for no benefit a targeted refetch doesn't already provide.
- **Recommendation (real gap, not yet built)**: a lightweight toast system would improve perceived
  feedback for successful mutations that currently rely on "the modal closed" as the only signal — worth
  adding in a future UI pass (a simple positioned-container + auto-dismiss component under
  `src/components/ui/`, no external dependency needed given this app's minimal-dependency philosophy already
  shown elsewhere) but is explicitly **not** something this audit is retrofitting; document it here as a
  considered, deferred improvement.

## 5. Empty States

Two conventions, both legitimate, scoped by context — this was checked closely since it's an easy place for
real inconsistency, and the two variants are genuinely serving different situations rather than drifting:
- **Inside a table** (a row spanning every column): plain centered text, no border/box —
  `"No records found."` for `DataTable.tsx:158-163` and `SimpleLookupManager.tsx:256-261`. Keep this exact
  copy for any new `DataTable`/`SimpleLookupManager`-backed list — don't invent a per-module variant like "No
  customers yet" (checked: no such per-module text exists today; the generic string is the actual, converged
  standard, unlike CLAUDE.md's preamble text which described this as inconsistent per-page copy — that
  described the *general engineering instruction*, not what was actually found in the current codebase).
- **A full report/panel with nothing to show**: a dashed-border box, centered, `rounded-md border
  border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500` —
  `ReportTable.tsx:29` (default message `"No data for the selected filters."`, overridable per report via
  the `emptyMessage` prop) and reused verbatim for a report's `unavailableReason` state
  (`ReportPage.tsx:139-142`, amber-tinted variant for "this report has no underlying schema yet," e.g.
  Payroll — see CLAUDE.md's Phase 9 section). **Standard**: use the plain in-table text row for a
  `DataTable`/`SimpleLookupManager` context (matches the table chrome around it); use the dashed box for a
  standalone panel/report/section that has no surrounding table structure to sit inside. Don't mix them —
  a dashed box inside a `DataTable` row would look out of place against that table's own borders.
- Every empty state must state **why** where the reason is knowable (`ReportPage.tsx:140`'s
  `unavailableReason` is real, per-report text like "no payroll module exists in this ERP" per CLAUDE.md,
  never a generic "coming soon") — plain "No records found" is only acceptable when the absence is just "no
  data yet," not "this feature doesn't exist."

## 6. Loading States

**Universally plain text, never a skeleton or spinner** — confirmed by reading every shared component:
`"Loading…"` (with a real ellipsis character, not three periods) appears identically in
`DataTable.tsx:151-156`, `SimpleLookupManager.tsx:249-254`, and `ReportPage.tsx:138` (`<p
className="text-sm text-zinc-500">Loading…</p>`). **This is the converged, intentional standard for this
app** — do not introduce a skeleton-loader component or a spinner icon for a new list/table; match the
existing plain-text convention for consistency, especially since no icon library exists to build a spinner
from without adding a new dependency (see `DESIGN_SYSTEM.md` § Iconography).
- Button-level busy state uses a **label swap**, not a spinner: `disabled` + relabel to `"Please wait…"`
  (`ConfirmModal.tsx:59,63`) or a verb-ing form like `"Importing…"`/`"Signing in…"`
  (`CsvImportModal.tsx:249,251`, `login/page.tsx:89,92`). Use this same relabel-on-`isSubmitting` pattern for
  any new submit button — never leave a button's label static while merely graying it out.

## 7. Error States & Validation

- **Field-level validation error**: rendered by `FormField`'s own `error` prop —
  `<p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>` directly under the input
  (`FormField.tsx:19`). Required fields get a red asterisk appended to the label:
  `{required && <span className="text-red-500"> *</span>}` (`FormField.tsx:16`) — this is the sole required-
  field marking convention; don't invent a second one (e.g. a trailing "(required)" text label) for a new
  form.
- **Form-level/action-level error** (a failed submit, a blocked business-rule action): a plain `<p
  className="text-sm text-red-600 dark:text-red-400">` banner directly above or below the relevant action —
  never a modal, never a toast (see § 4). This is the direct UI expression of a `BusinessRuleError`: the
  route handler's structured `{ error: { code, message, details } }` response (per CLAUDE.md's API
  Architecture section) always resolves to exactly this one paragraph of `message` text — `code` drives
  conditional UI (e.g. surfacing an "override" escape hatch specifically for a `409` blocked-by-gate error,
  as in Sales Order's sample-approval override flow) but is never shown to the user as raw text.
- **Never a raw stack trace or bare 500** reaches the UI — every module's own service layer maps failures to
  `BusinessRuleError` subclasses with a friendly template (CLAUDE.md documents an entire QA pass dedicated to
  closing raw-500 leaks, e.g. malformed `:id` → clean 400, duplicate-code races → clean 409). Any new route
  handler must throw a `BusinessRuleError` subclass, never let a raw Prisma/JS error escape to the client.

## 8. Dashboard Widget Layout Rules

Reference: `src/app/(dashboard)/dashboard/page.tsx` (the role-aware Executive/Team/Platform dashboard,
CLAUDE.md's 2026-08-29 entry) and `src/components/reports/ReportPage.tsx`'s `renderKpis` slot.
- KPI tiles are a `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5` of uniform cards
  (`dashboard/page.tsx:6`): `rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800
  dark:bg-zinc-900`, a big `text-2xl font-semibold` number on top, a `mt-1 text-xs text-zinc-500` label
  underneath (`dashboard/page.tsx:8-11`). This exact card shape is the standard for any new KPI tile row —
  match it rather than inventing a new card style per dashboard.
  - `StatTiles` is currently a **locally-defined, non-exported function inside `dashboard/page.tsx`** — a
    genuine small duplication risk (`ReportPage.tsx`'s own KPI rendering is a separate, per-report
    `renderKpis` callback rather than reusing this component) worth promoting to
    `src/components/ui/StatTiles.tsx` the next time a second page needs an identical KPI-tile grid (see
    `COMPONENT_GUIDELINES.md` § when to promote a local component).
- When a report supplies `renderKpis`, the generic flat `ReportTable` underneath it is **skipped entirely**
  (`ReportPage.tsx:150-154`) — a documented, deliberate fix (CLAUDE.md, Phase 9 QA sweep) for what was
  previously a redundant flat table under cards that already showed every row. **Any new KPI-card report
  must either supply `renderKpis` and accept the table being hidden, or omit `renderKpis` and rely on the
  table** — never render both.
- A dashboard section's own descriptive text sits directly under its `<h1>` in the same `mt-1 text-sm
  text-zinc-500` style as every other page (§ Typography in `DESIGN_SYSTEM.md`) — dashboards do not get a
  different header treatment than an ordinary list page.

## 9. Responsive Behavior Rules

- **Confirmed working today**: form field grids collapse from multi-column to single-column via
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (`SamplingFilters.tsx:135`), and KPI tile rows collapse
  similarly (`dashboard/page.tsx:6`). Tables scroll horizontally inside their own
  `overflow-x-auto` wrapper rather than squeezing columns (`DataTable.tsx:131`, `ReportTable.tsx:33`) — this
  matches the stated "localized horizontal scroll is fine for large tables" principle.
- **Confirmed NOT built (real, honest gap)**: the sidebar is a fixed, non-collapsible `w-64`
  (`Sidebar.tsx:83`) with zero responsive/mobile behavior — no hamburger toggle, no drawer, no `md:hidden`
  anywhere in `src/components/layout/`. On a genuine 375–430px mobile viewport, this sidebar would either
  overlap content or force horizontal scroll on the whole page (not just a table), which the project's own
  stated "never create unwanted horizontal scroll on the overall page" rule explicitly warns against.
  **Recommendation**: introduce a drawer-style sidebar below a `lg:` (or `md:`) breakpoint — hidden by
  default, toggled via a hamburger button added to `Topbar.tsx`, sliding over content rather than pushing it
  — this is the standard, minimal-risk fix and should reuse `Modal`'s existing backdrop+Escape-to-close
  behavior (a drawer is structurally a Modal anchored to one edge) rather than inventing new open/close
  plumbing. This is flagged as an unaddressed gap, not fixed by this audit.
- The `Topbar`'s global search input (`Topbar.tsx:24-28`) has `max-w-md` but no responsive collapse of its
  own — on a narrow viewport it would compete for space with the (currently non-collapsing) sidebar; this
  compounds the gap above rather than being a separate issue.

## 10. Accessibility Rules

**What's actually present** (confirmed by direct inspection, not assumed):
- `role="dialog" aria-modal="true"` + a labelled title on both dialog primitives (`Modal.tsx:50-52`,
  `ConfirmModal.tsx:32-34`, `FilePreviewModal.tsx:51-52`).
- `role="switch" aria-checked aria-label` on `ToggleSwitch.tsx:15-17`, with a `title` tooltip duplicating the
  same text for sighted mouse users.
- `aria-label` on every icon-only/glyph-only button: `Modal`'s ✕ (`Modal.tsx:66`), `FilePreviewModal`'s
  `ToolbarButton` (`FilePreviewModal.tsx:134`), `Barcode`'s `role="img" aria-label` (`Barcode.tsx:31`).
- `aria-label="Breadcrumb"` on the nav landmark (`Breadcrumb.tsx:10`).
- Keyboard support: `Escape` closes both `Modal` and `FilePreviewModal` (window-level listener); `DataTable`
  rows with an `href` are `tabIndex={0}` with an `onKeyDown` handler that navigates on `Enter`
  (`DataTable.tsx:179-186`) — **any new clickable-but-not-a-real-`<a>` row/card must replicate this exact
  tabIndex+Enter pattern**, don't ship a mouse-only clickable `<div>`.
- Focus rings are present on every text input/select (`focus:ring-1 focus:ring-indigo-500`,
  `FormField.tsx:25`) and are never suppressed (`focus:outline-none` is always paired with a replacement
  `focus:ring-*`, never used alone — confirmed, no bare `focus:outline-none` without a ring exists in any
  shared component).
- `<html lang="en">` is set (`src/app/layout.tsx:24`).

**What's confirmed absent (real gaps, not oversights to paper over)**:
- **No `aria-live`/`role="alert"` anywhere in the codebase** (confirmed by Grep — zero matches). Every
  inline error/success message (§ 4, § 7) is a plain `<p>` with no live-region announcement — a screen
  reader user gets no automatic notification when a form submission fails or an action's inline error
  appears; they'd need to navigate to it manually. **Recommendation**: add `role="alert"` (or a `aria-live=
  "polite"` wrapper) to the shared inline-error paragraph pattern — this is a small, mechanical fix once
  prioritized (it would touch every form's error paragraph, ideally by promoting a shared `<ErrorText>`
  component per `COMPONENT_GUIDELINES.md`'s reuse guidance, rather than hand-editing each of the ~30 forms).
- **No skip-to-content link** — a keyboard user must tab through the entire sidebar before reaching page
  content on every single page load. Not present in `layout.tsx` or `DashboardLayout`.
- **No user-facing dark-mode toggle** (see `DESIGN_SYSTEM.md` § Dark Mode) — not an accessibility defect per
  se, but worth noting alongside these gaps since it's the same "OS-only, no in-app control" category.
- **Color contrast**: see `DESIGN_SYSTEM.md` § 8 — one borderline case (`text-zinc-400` on white) flagged,
  scoped to caption-level text only.

## 11. Keyboard Navigation Rules

- **Tab order**: standard DOM order, no custom `tabIndex` values anywhere except `DataTable`'s clickable
  rows (`tabIndex={0}`, § 10) — never introduce a positive `tabIndex` (e.g. `tabIndex={1}`); none exist
  today and doing so would break the natural order everywhere else.
- **Enter-to-submit**: native `<form onSubmit>` behavior is relied on everywhere (every `*Form.tsx` file) —
  no custom Enter-key interception exists or should be added for ordinary forms.
- **Enter-to-navigate on a table row**: `DataTable.tsx:180-186` — `Enter` triggers the same navigation as a
  click, only when the row has an `href`. This is the one place Enter is intercepted outside a form, and it
  exists specifically to make an inherently mouse-oriented "clickable row" pattern keyboard-accessible —
  replicate this exact shape (never a bare `onClick` on a non-interactive element) for any future
  custom/worklist table that isn't built on `DataTable` itself (e.g. Sampling's own worklist table, per
  CLAUDE.md's 2026-08-19 entry, should be checked for the same pattern if extended).
- **Escape-to-close**: both `Modal` and `FilePreviewModal` bind a window-level `keydown` listener scoped to
  `open` (added/removed via the effect's cleanup) — any new full-screen or overlay component must follow this
  same add-listener-only-while-open, remove-on-close/unmount shape to avoid leaking a global listener.
- **Arrow-key navigation**: implemented once, in `MaterialPicker.tsx:89-111` (a combobox: `ArrowDown`/
  `ArrowUp` move a highlighted index, `Enter` selects, `Escape` closes) — this is the reference
  implementation for any future searchable-combobox component; don't rebuild arrow-key handling from scratch
  without checking this file first.
