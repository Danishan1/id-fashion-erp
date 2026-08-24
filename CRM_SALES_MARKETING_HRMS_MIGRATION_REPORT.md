# CRM, Sales, Marketing & HRMS Migration Report
**Source:** `D:\office-data\Project\indradhar\virtual-ceo` (WordPress "EQ Business OS" — plugins `eq-crm` 1.5.0, `eq-marketing` 1.3.0, `eq-hrms` 1.8.4, `eq-finance` 1.4.0)
**Target:** Fashion ERP (`D:\office-data\claude-projects\fashion-erp`)
**Status:** Analysis & mapping complete. **No code has been written or modified.** This is the STOP-and-approve gate requested before any implementation begins.

---

## 1. How this analysis was done

The source project ships its own `PROJECT_DOCUMENTATION.md` (a prior reverse-engineering pass) — read in full first. Every business rule and schema fact below was then independently re-verified against the actual PHP source (`eq-crm.php`, `eq-marketing.php`, `eq-hrms.php` — all read in full) rather than taken on the documentation's word alone, since the task explicitly requires that. The Fashion ERP side was verified the same way: live `prisma/schema.prisma`, `src/config/rbac.ts`, and the actual `Customer`/`SalesAgent`/`Employee`/`BuyerEnquiry` models, not CLAUDE.md's prose summaries.

**Architecture reality check up front:** the source is a single-tenant WordPress site with **no multi-tenancy at all** — `$wpdb->prefix` tables are global to the one WordPress install. Every one of the phased instructions about "respect tenant isolation" therefore has no WordPress-side precedent to preserve; tenant scoping is a pure Fashion-ERP-side requirement (already the project's standing convention: every table gets `company_id`).

---

## 2. Source system inventory (verified from code, not assumed)

### 2.1 CRM (`eq-crm`, 9 tables)

| Table | Real columns (from the actual `CREATE TABLE`) |
|---|---|
| `eq_crm_leads` | `lead_code` (unique), `name`, `email`, `phone`, `company`, `source`, `campaign`, `assigned_to` (→ wp_user), `status`, `lead_score` decimal, `value` decimal, `expected_close` date, `priority`, `last_activity_at`, `notes` |
| `eq_crm_customers` | `customer_code` (unique), `name`, `email`, `phone`, `company`, `source`, `notes` — **no lead_id FK at all**; conversion is copy-not-link (see §3) |
| `eq_crm_deals` | `lead_id`, `customer_id`, `title`, `stage`, `value`, `probability`, `assigned_to`, `expected_close`, `lost_reason`, `notes` |
| `eq_crm_followups` | `lead_id`, `customer_id`, `assigned_to`, `followup_date`, `type` (call/whatsapp/email/meeting/note), `status`, `notes`, `completed_at` |
| `eq_crm_activities` | `lead_id`, `customer_id`, `deal_id`, `user_id`, `activity_type`, `subject`, `body`, `activity_at` |
| `eq_crm_automation_logs` | `lead_id`, `rule_key`, `action`, `details` — audit trail of the automation engine |
| `eq_crm_nurture_sequences` | `name`, `description`, `status`, `steps` (JSON array of `{delay_days, channel, subject, message}`) |
| `eq_crm_nurture_enrollments` | `sequence_id`, `lead_id`, `current_step`, `next_run_at`, `status`, unique on `(sequence_id, lead_id)` |
| `eq_crm_notifications` | `lead_id`, `user_id`, `channel` (dashboard/email/whatsapp), `event_key`, `subject`, `message`, `scheduled_at`, `sent_at`, `status` |

**Status enum in practice** (from the actual `<select>` in `eq_crm_leads()`): `new, contacted, qualified, proposal, negotiation, won, lost`. Note this conflates *lead* status and *deal* stage into one field on Leads, while `eq_crm_deals.stage` has its own separate, overlapping set: `qualified, proposal, negotiation, won, lost`. **This is a real WordPress-side data-model wart, not a business rule to preserve deliberately** — flagged in §3.

### 2.2 Sales (there is no separate "Sales" plugin — it's `eq-crm`'s Deals + `eq-finance`'s Invoices)

The task brief treats "Sales" as a distinct module, but the source code doesn't — Sales *is* `eq_crm_deals` (pipeline) feeding `eq_fin_invoices` (billing) once a deal is won. There is no `eq_crm_quotations`, `eq_crm_products`, `eq_crm_pricelists`, or `eq_crm_orders` table anywhere in the source. **Verified absent, not assumed** — grepped the full CRM file for any product/quotation/order table and found none.

### 2.3 Marketing (`eq-marketing`, 6 tables)

| Table | Real columns |
|---|---|
| `eq_mkt_campaigns` | `campaign_code`, `name`, `objective`, `channel`, `start_date`, `end_date`, `budget`, `spend`, `leads`, `qualified_leads`, `customers`, `revenue`, `owner`, `status` (draft/active/paused/completed), `approval_status` (pending/approved/rejected) |
| `eq_mkt_daily_metrics` | `campaign_id`, `metric_date`, `spend`, `impressions`, `clicks`, `leads`, `qualified_leads`, `customers`, `revenue` — unique `(campaign_id, metric_date)` |
| `eq_mkt_attribution` | `campaign_id`, `lead_id`, `customer_name`, `source`, `medium`, `content`, `term`, `utm_campaign`, `landing_page`, `first_touch`/`last_touch` flags, `attributed_revenue` |
| `eq_mkt_budget_changes` | `campaign_id`, `user_id`, `old_budget`, `new_budget`, `reason` — a real audit trail for budget edits |
| `eq_mkt_lead_map` | `lead_id` (unique — one row per lead), `campaign_id`, `source/medium/campaign/content/term`, `landing_page`, `lead_quality` (high/medium/low), `conversion_status` (lead/qualified/customer), `crm_customer_id`, `first_touch_at`/`last_touch_at` |
| `eq_mkt_alerts` | `alert_type`, `priority`, `campaign_id`, `title`, `message`, `metric_value`, `threshold_value`, `status` |

### 2.4 HRMS (`eq-hrms`, 8 tables — verified, no recruitment tables exist)

`eq_hrms_departments`, `eq_hrms_employees` (`wp_user_id`, `employee_code`, `name`, `email`, `phone`, `department_id`, `designation`, `manager_id`, `joining_date`, `salary`, `status`), `eq_hrms_attendance` (`employee_id`, `attendance_date`, `punch_in`, `punch_out`, `remarks`, unique per employee/day), `eq_hrms_leave_types` (`name`, `days`), `eq_hrms_leaves` (`employee_id`, `leave_type`, `start_date`, `end_date`, `reason`, `status`, `approved_by`), `eq_hrms_payroll` (`employee_id`, `pay_month`, `basic`, `allowances`, `deductions`, `bonus`, `gross`, `net_salary`, `payment_status`, `paid_date`, unique per employee/month), `eq_hrms_kpis` (`name`, `department_id`, `target_type`, `target_value`, `weight`), `eq_hrms_performance` (`employee_id`, `kpi_id`, `period`, `achievement`, `score`, `manager_rating`, `manager_remarks`, `review_status`, `reviewed_by`).

**Confirmed absent (per the task's own "do not assume" instruction):** no Recruitment module (no candidates/job-openings/interviews table exists anywhere in `eq-hrms.php`), no salary-structure/component master (payroll fields are flat columns — `basic/allowances/deductions/bonus`, not a configurable component template), no PF/ESIC fields, no shift/holiday tables (Fashion ERP already has both, and better).

---

## 3. Business logic actually discovered (exact rules, from code — not paraphrased)

### 3.1 Lead lifecycle
- **Scoring → priority**, computed in `eq_crm_leads()` on every save: `lead_score >= 80 → hot`, `>= 50 → warm`, else `normal`. A flat threshold, no weighting/decay.
- **Round-robin assignment**: only fires when `assigned_to` is left blank. Pulls the last-assigned user from the leads table, finds their index in the *current* `get_users()` list (max 100 users), and assigns to `(index+1) % count`. **Not a stored rotation pointer** — it's re-derived from the last lead's assignee every time, so if that lead's assignment later changes, the "next" rotation shifts unpredictably. This is a real, somewhat fragile implementation detail, not a deliberate design worth preserving as-is.
- **Auto follow-up**: creating a lead with status `new` or `contacted` and no existing follow-up row auto-inserts one call follow-up 24h out ("Auto-created by EQ CRM").
- **Duplicate detection**: on save, a `WHERE email=%s OR phone=%s` check (excluding self on edit) blocks the save entirely with a warning — no override, no merge, just a hard stop.
- **Lead → Customer is NOT a conversion, it's a coincidence detector.** There is no `convert_lead_to_customer()` function anywhere. The only place a lead and a customer are ever linked is `eq_mkt_sync_crm_leads()`, which — for leads with `status = 'won'` — does `SELECT c.id FROM customers c JOIN leads l ON l.email=c.email OR l.phone=c.phone`, i.e. it *guesses* a customer already exists by matching email/phone, and only for marketing-attribution bookkeeping (`eq_mkt_lead_map.crm_customer_id`). **A won lead does not automatically create a Customer row in `eq_crm_customers` anywhere in the source.** This is a genuine gap in the source system, not a workflow to faithfully replicate as "conversion logic" — the task brief's assumed `Lead → Opportunity → Deal → Customer → Sale` pipeline does not actually exist as code; it exists only as an aspirational diagram in the documentation.

### 3.2 Deal pipeline
- Stages: `qualified, proposal, negotiation, won, lost` — plain strings, no `ALLOWED_TRANSITIONS` enforcement anywhere; a deal can jump from `qualified` straight to `won` or back to any earlier stage with no guard at all.
- **Weighted value** = `value * probability / 100`, computed at display time only, never stored.
- **Open pipeline** = `SUM(value) WHERE stage NOT IN ('won','lost')`. **Won revenue** = `SUM(value) WHERE stage='won')`. Both computed live on every dashboard/API call, no cached rollup.
- No discount, tax, or line-item logic anywhere on a Deal — `value` is a single flat number entered by hand.

### 3.3 Follow-ups & activities
- A follow-up is "overdue" purely by `status='pending' AND followup_date < NOW()` at read time — never a stored flag.
- Reminders (`eq_crm_followup_reminders()`) only fire once per 24h window per follow-up (`event_key = 'followup_{id}'`, deduped by checking for an existing notification with that key created in the last day) — a simple but real de-dup mechanism worth preserving conceptually.
- Activities are a flat append-only log (`call/whatsapp/email/meeting/note`), no threading, no reply-to.

### 3.4 Notifications & nurture automation
- Notification queue: `queued → sent/failed`, processed hourly via WP-Cron (`eq_crm_v13_cron`). Only `email` channel is actually implemented (`wp_mail`); `dashboard`/`whatsapp` channels are queued and immediately marked `sent` via a no-op `do_action` hook — **these two channels are not really implemented**, just plumbed for a future connector. Important not to over-build parity here.
- Nurture sequences: up to a fixed 3-step JSON array per sequence (UI hardcodes 3 fieldsets), each step has `delay_days/channel/subject/message`. Enrollment advances one step per cron run once `next_run_at` is reached; completes when steps run out.

### 3.5 Marketing automation (`eq_mkt_run_automation`, hourly cron)
Real, code-verified thresholds — worth preserving exactly since they're specific, tuned numbers:
- **Budget overspend**: `spend > budget` → high-priority alert. **80% budget alert**: `spend >= budget * 0.8` → medium.
- **Low ROAS**: only once `spend >= 1000` (a minimum-spend gate to avoid noise on tiny campaigns) — `roas < 1.0` → high alert ("below break-even"); `roas < 1.5` → medium ("needs review").
- **High CPL**: only once `leads >= 10` — compares the campaign's own CPL against the **average CPL of every other campaign on the same channel with `leads >= 10`**; alerts if more than 1.5× that peer benchmark.
- **Low conversion**: only once `leads >= 20` — `customers/leads < 2%` → medium alert.
- Every alert type is deduplicated per-campaign while `status='open'` (`eq_mkt_alert_exists`) — never double-fires the same open alert.
- `eq_mkt_sync_crm_leads()` runs every automation cycle and is the *only* bridge from CRM leads into Marketing's attribution world — it re-derives `lead_quality` from the lead's own score (`>=80 high, >=50 medium, else low` — note this duplicates the hot/warm/normal thresholds under different labels) and `conversion_status` from the lead's own status.

### 3.6 HRMS
- **Late arrival**: hardcoded `punch_in > attendance_date + '10:15:00'` → flagged late at *read* time in the daily attendance report — not stored on the row.
- **Payroll**: `gross = basic + allowances + bonus` (bonus is folded into gross, not a separate line after), `net_salary = gross - deductions`. Flat manual entry per employee per month — **no attendance/leave-driven automatic calculation exists**; a `pay_month` unique constraint just prevents double-entry for the same employee+month.
- **Leave**: a `leave_types` master with a flat `days` allocation number (interpreted as an annual quota, never actually enforced against a running balance anywhere in the code found — no balance-deduction logic exists).
- **KPI/Performance**: a KPI has a `target_value`/`weight`; a Performance row records one employee's `achievement`/`score`/`manager_rating` against one KPI for one `period` string (freeform, e.g. "2026-Q3"), unique per `(employee, kpi, period)`.

### 3.7 GST/Finance (context only — Accounts/Phase 7 doesn't exist in Fashion ERP yet, so this is not being migrated now, but documented since Sales↔Accounting integration was requested)
Intra-state: `CGST = tax/2, SGST = tax/2`. Inter-state: `IGST = tax`. This is a real, correct GST-splitting rule worth carrying forward *whenever* Phase 7 (Accounts) is eventually built — noted here so it isn't lost, not acted on now.

---

## 4. Fashion ERP: what already exists (verified against live schema, not assumed)

| Concept | Fashion ERP reality |
|---|---|
| **Customer** | Full model — `code, name, type (CUSTOMER/AGENT), country, paymentTermsDays, creditLimit, defaultCurrencyCode, isActive`. Company-scoped, soft-deletable. No `source`/lifecycle/score fields — it's a pure master, not a CRM record. |
| **Lead / Prospect** | **No dedicated Lead table.** The closest analog is `BuyerEnquiry.prospectName/prospectEmail/prospectPhone/prospectCountry` — explicitly documented in-schema as "deliberately NOT a Prospect/Lead master table — no lifecycle, no promotion workflow, no reminders." This was a deliberate scope decision made earlier in this project (see CLAUDE.md's Buyer Enquiry section), not an oversight. |
| **Deal / Opportunity / Pipeline** | **Does not exist at all.** `SalesOrder` is the closest analog but represents a *confirmed* order with real style/variant/quantity/breakdown lines — nothing pre-sale/probabilistic exists. |
| **Sales Rep** | `SalesAgent` exists — `code, name, contactPerson, email, phone, commissionPercent`. Built for the *domestic/retail* channel specifically (distinct from export `Buyer`s), commission-based. This is close to (but not identical to) a CRM "salesperson" concept — WordPress's `assigned_to` is any `wp_user`, Fashion ERP's `User` table is the actual login/RBAC identity, and `Employee` is the HR record; `SalesAgent` is a third, separate concept for commission tracking. All three exist independently today. |
| **Follow-up / Activity / Task** | Does not exist anywhere in the schema as a generic CRM concept. `SampleComment` exists but is scoped to Sampling only. |
| **Campaign / Marketing** | Does not exist at all — zero schema, zero RBAC module. |
| **Employee / Department** | Full model (see `Employee`: `employeeCode, fullName, designation (string), departmentId, reportsToId, joinDate`). `reportsToId` is a genuine self-relation — Fashion ERP already has manager hierarchy. |
| **Attendance / Leave / Payroll** | **Do not exist.** Only `HolidayMaster` (company-wide holiday calendar) and `ShiftMaster` (shift definitions) exist as lookup masters (`hr-config` module) — no punch/attendance transaction table, no leave-request/balance table, no payroll table anywhere. |
| **Designation** | `Designation` master exists (`hr-config`) but is **not wired as an FK** — `Employee.designation` is still a plain string, per an already-documented pending item in CLAUDE.md. |
| **KPI / Performance Review** | Does not exist. |
| **Recruitment** | Does not exist — consistent, since the WordPress source doesn't have it either. |
| **RBAC modules** | `MODULES` in `src/config/rbac.ts` has no `crm`, `sales_crm`, `marketing`, or `hrms` module today — `sales_orders`, `masters_core`, `inventory`, `purchasing`, `production`, `qc`, `bom_mrp`, `sampling`, `buyer_enquiries` etc. exist. Adding CRM/Marketing/HRMS-Attendance-Leave-Payroll modules is additive, no renaming needed. |

**Direct implication for §6's "no duplicate Customer/Lead system" rule**: Fashion ERP's `Customer` stays the single canonical customer record — a migrated CRM must reference it, never fork it. `BuyerEnquiry` is a legitimate, deliberate landing spot for "prospect capture" and should be **considered as the base to extend**, not bypassed by inventing a parallel `Lead` table, unless a genuine capability gap forces a new table (see §6).

---

## 5. Feature inventory — only what's real (per the task's own "only include features that actually exist" instruction)

**CRM (real):** Lead capture + manual scoring + priority derivation, round-robin auto-assignment, duplicate email/phone detection, lead status (7 values, shared/overlapping with deal stage), Customer master (flat, no FK to originating lead), Deal/pipeline (5 stages, weighted value), Follow-ups (typed, overdue-by-date-comparison), Activity timeline (5 types), 3-step nurture sequences, notification queue (email-only real channel), CSV import/export for leads/customers/deals, inbound/outbound HMAC-signed webhooks, salesperson leaderboard (leads/pipeline/won-revenue per user).

**CRM (NOT real, despite being asked to check for):** Lead scoring *models* (it's one flat threshold, not a scoring algorithm), Company/Contact as separate entities (they're free-text fields on Lead/Customer, not their own tables), Customer Groups/Segmentation, Tags, Territories, Teams, Addresses, structured Lead→Customer conversion, Quotations, Sales Orders, Products/Pricing/Price Lists/Discounts/Taxes (none of this exists in `eq-crm` — it lives, partially, in `eq-finance`'s invoicing, which is a different plugin and largely out of this migration's scope until Accounts/Phase 7 exists).

**Sales (real, but it's really "Deals," not a separate module):** Pipeline stages, weighted revenue, salesperson performance leaderboard, lost-reason capture.

**Marketing (real):** Campaigns (budget/spend/status/approval workflow), daily per-campaign metrics, UTM/attribution tracking with first/last-touch flags, lead-to-campaign mapping with quality/conversion-status derivation, Meta Ads + Google Ads API sync (real HTTP integration code, not a stub), automated threshold alerts (budget/ROAS/CPL/conversion — exact formulas in §3.5), budget-change audit trail, CSV import, webhooks.

**Marketing (NOT real):** Marketing Lists (as a distinct entity — the closest thing is the lead_map table itself), Email Marketing (sending), Promotions/Offers, a dedicated "Segments" concept (only `lead_quality` exists, a 3-value derived field, not a real segmentation engine).

**HRMS (real):** Employee directory with manager hierarchy, department headcount, punch in/out attendance with a hardcoded late-cutoff, leave-type master + leave requests (status-only, no real balance tracking), flat monthly payroll entry, KPI + performance review with manager rating, employee/manager self-service portals.

**HRMS (NOT real):** Recruitment (entire module absent), Salary Structures/Components (flat columns, not a template system), PF/ESIC, structured leave-balance accrual/carry-forward, org chart visualization (only implied by `manager_id`, no chart UI), shift assignment (Fashion ERP already has `ShiftMaster`, source doesn't even have this).

---

## 6. Source → Target mapping

| WP Module | WP Entity | WP Logic (condensed) | Fashion ERP Equivalent | Existing/New | Action |
|---|---|---|---|---|---|
| CRM | `eq_crm_customers` | Flat customer record | `Customer` | **Existing** | Extend only if a real gap surfaces (e.g. a `source` field) — do not fork |
| CRM | `eq_crm_leads` | Score→priority, round-robin, dup-check, auto-followup | *(none)* — closest is `BuyerEnquiry` prospect fields | **New**, but *evaluate extending `BuyerEnquiry` first* | See decision note below |
| CRM | `eq_crm_deals` | 5-stage pipeline, weighted value | *(none)* | **New** | Create `Opportunity`/`Deal` model — do NOT reuse `SalesOrder` (different lifecycle, pre-commit vs. confirmed-order) |
| CRM | `eq_crm_followups` | Typed reminders, overdue-by-comparison | *(none — generic)* | **New** | Create a generic `CrmActivity`-adjacent `Followup`/`Task` model, scoped to Lead/Deal/Customer polymorphically (reuse `RelatedModule` enum convention already used for `Attachment`) |
| CRM | `eq_crm_activities` | Typed timeline | *(none)* | **New** | Same polymorphic-reference convention |
| CRM | `eq_crm_nurture_*` | 3-step sequences | *(none)* | **New, low priority** | Defer unless explicitly requested — real email-sending infra doesn't exist in Fashion ERP either |
| CRM | `eq_crm_notifications` | Queued email notices | `Notification` (System table, already exists!) | **Existing** | Extend — Fashion ERP already has a `notifications` table per Phase 1 planning; verify its shape before adding a parallel queue |
| Sales | `eq_crm_deals` (same table, sales lens) | Salesperson leaderboard | `SalesAgent` + new `Deal.assignedToId` | **Partially existing** | `SalesAgent` reused for commission-tracked deals; a Deal can alternatively be owned by a `User` (matches WP's `wp_user`-based `assigned_to`) — needs a decision (see §9) |
| Sales | *(none — doesn't exist in source)* | — | `SalesOrder` | **Existing, unaffected** | No change — a won Deal should be able to *originate* a Sales Order (new FK), mirroring the existing `SalesOrderItem.sampleRequestId` traceability pattern |
| Marketing | `eq_mkt_campaigns` | Budget/spend/approval | *(none)* | **New** | Create `Campaign` model |
| Marketing | `eq_mkt_daily_metrics` | Daily spend/impressions/clicks | *(none)* | **New** | Create `CampaignDailyMetric`, unique `(campaignId, metricDate)` exactly like the source |
| Marketing | `eq_mkt_attribution` | UTM/first-last-touch | *(none)* | **New** | Create `CampaignAttribution`, FK to the new Lead entity |
| Marketing | `eq_mkt_lead_map` | Lead quality/conversion derived fields | *(none)* | **New, but reconsider** | This table largely *duplicates* fields already on the source's own Lead table (`lead_quality` ≈ `priority`, `conversion_status` ≈ `status`) — in Fashion ERP, prefer folding these as computed values off the new Lead/Deal entities rather than a second table, avoiding the exact "two sources of truth" anti-pattern this codebase has fixed multiple times before (Material Request status, Sample damage tracking, etc.) |
| Marketing | `eq_mkt_alerts` | Threshold-based alerts | *(none)* | **New** | Straightforward port of the 4 formulas in §3.5 |
| Marketing | `eq_mkt_budget_changes` | Audit trail | `AuditLog` (System table, already exists!) | **Existing** | Reuse `writeAuditLog()` instead of a parallel table — exactly matches this project's established convention |
| HRMS | `eq_hrms_employees` | Flat employee + manager_id | `Employee` | **Existing** | Extend only for genuinely missing fields (none identified — Fashion ERP's `Employee` is already a superset) |
| HRMS | `eq_hrms_departments` | Flat department | `Department` | **Existing** | No change |
| HRMS | `eq_hrms_attendance` | Punch in/out, late-by-comparison | *(none)* | **New** | Create `AttendanceRecord`, unique `(employeeId, attendanceDate)`, mirroring the source exactly; late-flag computed, not stored (matches source, and matches this project's own "derive don't duplicate" convention) |
| HRMS | `eq_hrms_leave_types`, `eq_hrms_leaves` | Flat quota, request/approve | *(none)* | **New** | Create `LeaveType` + `LeaveRequest`; **improve** on the source by actually tracking a running balance (source doesn't), flagged as a deliberate improvement, not scope creep, since "approve a leave that already exceeds balance" is an obvious real-world gap |
| HRMS | `eq_hrms_payroll` | Flat monthly entry | *(none)* | **New, lower priority** | Create `PayrollEntry` mirroring the flat structure; do NOT build a Salary Structure/component template system — the source doesn't have one, and inventing one would be scope creep beyond parity |
| HRMS | `eq_hrms_kpis`, `eq_hrms_performance` | KPI + review | *(none)* | **New, lower priority** | Straightforward two-table port |
| HRMS | Recruitment | — | — | **N/A** | Confirmed absent in source; do not build |

### Decision needed: Lead — extend `BuyerEnquiry` or create a new `Lead` model?

This is the single highest-leverage decision in the whole migration, and the brief's own "do not duplicate existing entities" rule points straight at it. Two real options, not a rhetorical either/or:

- **Option A — Extend `BuyerEnquiry`.** It already has prospect fields, a status enum, a source enum, and a documented conversion path. Adding `assignedToUserId`, `leadScore`, `priority`, and reusing its existing lifecycle would avoid a second prospect-capture concept entirely.
- **Option B — New `Lead` model, separate from `BuyerEnquiry`.** `BuyerEnquiry` is scoped specifically to "a customer/prospect asking about a style, on the way to Sampling" — a garment-manufacturing-specific intake shape (it has `styleNameFreeText`, converts specifically into a `SampleRequest`). A CRM Lead is broader — a generic sales-qualification record that may have nothing to do with a specific style at all (e.g. "interested in becoming a customer" with no product discussed yet). Forcing every CRM lead through `BuyerEnquiry`'s style-centric shape would be the same kind of category error the project's own domain reference section already warns against elsewhere.

**Recommendation: Option B**, but with an explicit FK from `Lead` to `BuyerEnquiry` (nullable, one-directional) so a Lead that *does* turn into a real style enquiry can link forward into the existing Buyer Enquiry → Sample → Style pipeline instead of duplicating it. This preserves "don't build a second Customer/prospect system" in spirit (one really is upstream of the other, not a parallel fork) while not distorting `BuyerEnquiry`'s existing, working shape. **This needs your explicit confirmation before any schema work starts** — it's exactly the kind of "naming conflicts / duplicate concepts" judgment call §6 of the brief asks to flag rather than silently resolve.

---

## 7. Proposed Fashion ERP database design (additive only — nothing existing is touched except two new nullable FKs)

New tables, all following this project's existing conventions (UUID PK, `company_id` + `branch_id`, `created_at`/`updated_at`, soft-delete for masters, `document_sequences` for header numbering where a document number makes sense):

**CRM:**
- `Lead` — `leadNumber` (new `DocumentType.LEAD`, prefix e.g. `LEAD`), `name/email/phone/companyName`, `source` (reuse `EnquirySource`? — needs checking whether that enum is Buyer-Enquiry-specific or general), `leadScore`, `priority` (computed from score, not stored redundantly — see below), `status`, `assignedToUserId` (→ `User`, not `SalesAgent` — matches WP's `wp_user`-based assignment; a Deal separately gets an *optional* `SalesAgent` for commission), `value`, `expectedCloseDate`, `buyerEnquiryId` (nullable, per §6 decision), `notes`.
  - **Improvement over source, not scope creep**: `priority` should be a `@map` computed at read time (a small helper function, like `computeLeadPriority(score)`), never a stored column that can drift from `leadScore` — directly fixes the "two overlapping status concepts" wart flagged in §3.1, using this project's own established "derive, don't duplicate" discipline.
- `Deal` — `title`, `leadId?`, `customerId?`, `stage` (enum: `QUALIFIED/PROPOSAL/NEGOTIATION/WON/LOST` — a real `ALLOWED_TRANSITIONS` map should be added here, a genuine improvement since the source has none and this project always adds one), `value`, `probability`, `assignedToUserId`, `salesAgentId?`, `expectedCloseDate`, `lostReason`, `wonSalesOrderId?` (nullable FK — set when a won Deal spawns a real `SalesOrder`, giving the CRM↔Sales traceability the brief explicitly asks for).
- `CrmActivity` — polymorphic via the existing `RelatedModule`-style discriminator (`relatedModule: LEAD | DEAL | CUSTOMER`, `relatedRecordId`), `activityType`, `subject`, `body`, `activityAt`, `userId`.
- `CrmFollowup` — same polymorphic shape, `followupDate`, `type`, `status`, `notes`, `completedAt`. `isOverdue` computed, never stored (matches source behavior, matches project convention).

**Marketing:**
- `Campaign` — `campaignNumber`, `name`, `objective`, `channel`, `startDate/endDate`, `budget`, `spend` (derived from `CampaignDailyMetric` sum? — flagged as an open design question in §9, since the source stores it as a flat mutable column, which is exactly the kind of "second source of truth" this project avoids elsewhere), `ownerUserId`, `status`, `approvalStatus`.
- `CampaignDailyMetric` — unique `(campaignId, metricDate)`, mirrors source exactly.
- `CampaignAttribution` — `campaignId?`, `leadId?`, UTM fields, `firstTouch/lastTouch` booleans, `attributedRevenue`.
- `CampaignAlert` — `alertType`, `priority`, `campaignId?`, `title`, `message`, `metricValue`, `thresholdValue`, `status`.
- Budget-change history → **reuse `AuditLog`**, no new table (per §6's mapping table).

**HRMS:**
- `AttendanceRecord` — `employeeId`, `attendanceDate`, `punchIn?/punchOut?`, `remarks`, unique `(employeeId, attendanceDate)`. Late-flag: computed against `ShiftMaster`'s own `startTime` (a real improvement — the source hardcodes `10:15`, Fashion ERP already has a real shift concept to compute against instead).
- `LeaveType` (company-scoped, `name`, `annualDays`), `LeaveRequest` (`employeeId`, `leaveTypeId`, `startDate/endDate`, `reason`, `status`, `approvedByUserId`) + a computed running-balance query (source has none — this is the one deliberate improvement flagged above).
- `PayrollEntry` — flat columns matching source (`basic/allowances/deductions/bonus/gross/netSalary/paymentStatus/paidDate`), unique `(employeeId, payMonth)`.
- `Kpi` (`name`, `departmentId?`, `targetType`, `targetValue`, `weight`), `PerformanceReview` (`employeeId`, `kpiId`, `period`, `achievement`, `score`, `managerRating`, `managerRemarks`, `reviewStatus`, `reviewedByUserId`), unique `(employeeId, kpiId, period)`.

**Two additive changes to existing tables** (nothing else touched):
- `SalesOrder` gains an optional `originatingDealId` (nullable FK) — mirrors the existing `SalesOrderItem.sampleRequestId` traceability pattern exactly, giving the CRM↔Sales chain the brief asks for without touching `SalesOrder`'s existing required fields.
- `BuyerEnquiry` gains a virtual back-relation to `Lead` only if §6's Option B is confirmed (no physical column on `BuyerEnquiry` itself — same "one real FK, virtual back-relation" shape already proven by `BuyerEnquiryLine.sampleRequestId`).

---

## 8. Proposed API structure

Follows the existing `/api/v1/<module>/...` flat convention exactly (the project does **not** nest by parent module today — e.g. it's `/api/v1/sales-orders`, not `/api/v1/sales/orders` — so `/api/v1/leads`, `/api/v1/deals`, `/api/v1/campaigns` etc., not `/api/v1/crm/leads`, to stay consistent with every existing route rather than introduce a new nesting convention just for this migration):

`/api/v1/leads`, `/api/v1/leads/[id]`, `/api/v1/leads/[id]/status`, `/api/v1/leads/[id]/activities`, `/api/v1/leads/[id]/followups`, `/api/v1/deals`, `/api/v1/deals/[id]`, `/api/v1/deals/[id]/status` (with a real `ALLOWED_TRANSITIONS` guard), `/api/v1/deals/[id]/win` (the one action that can set `wonSalesOrderId`), `/api/v1/campaigns`, `/api/v1/campaigns/[id]`, `/api/v1/campaigns/[id]/daily-metrics`, `/api/v1/campaigns/[id]/alerts`, `/api/v1/attendance`, `/api/v1/leave-requests`, `/api/v1/leave-requests/[id]/approve`, `/api/v1/leave-requests/[id]/reject`, `/api/v1/payroll-entries`, `/api/v1/kpis`, `/api/v1/performance-reviews`.

All follow the existing `requireSession()` → `PermissionService.assert()` → Zod-parse → service-call → `handleApiError()` shape, no new pattern.

---

## 9. RBAC — proposed modules (following the existing naming convention, e.g. `masters_core`, `bom_mrp`, `sales_orders` — snake_case, not dot-notation)

`crm` (Leads + Deals + Activities/Followups), `marketing` (Campaigns), `hrms_attendance`, `hrms_leave`, `hrms_payroll`, `hrms_performance` — split the way `masters_core`/`masters_finance` were already split in this project, since payroll data needs materially tighter access than attendance/leave data (same reasoning that drove that earlier split). View/Create/Edit/Approve/Export actions per the existing convention; `hrms_payroll` gets `approve` for the same maker/checker reason `sampling`'s costing lock does.

**Real open questions, genuinely for you to decide, not defaulted:**
1. **§6's Lead/BuyerEnquiry decision** (above) — blocks all CRM schema work.
2. **Deal ownership**: `User` (matches WP's `assigned_to`) or `SalesAgent` (matches Fashion ERP's existing commission-tracked-salesperson concept) or both? Recommendation is both (optional `assignedToUserId` for who's working it day-to-day, optional `salesAgentId` for commission attribution) but this is your call, not mine to silently pick.
3. **Campaign.spend**: stored mutable column (matches source, simpler) vs. derived from `SUM(CampaignDailyMetric.spend)` (matches this project's "derive don't duplicate" discipline, but diverges from the source's own model where `spend` can be set directly without a daily breakdown, e.g. via CSV import of a lump sum). Recommendation: derive it, and treat a lump-sum CSV import as "one daily-metric row dated today" — but again, your call.
4. **Scope and sequencing**: this is four substantial module areas. Do you want all of them built in one pass, or should this proceed one at a time (CRM first, then Marketing, then HRMS) the way every other phase in this project has been built and verified individually before moving to the next? Given the size, **sequencing is strongly recommended** — CRM alone (Lead + Deal + Activity + Followup, schema + service + API + UI + tests) is comparable in scope to the Buyer Enquiry module, which was itself a multi-hour single-session build.
5. **HRMS priority**: Attendance/Leave are clearly useful; Payroll and KPI/Performance are lower-value ports of fairly thin source functionality (flat manual entry, no real calculation engine) — worth confirming whether they're wanted at all in v1, or genuinely deferrable.

---

## 10. Testing strategy (once scope is confirmed)

Unit tests for every derived/computed value called out above (lead priority from score, deal weighted value, campaign alert thresholds — all four formulas in §3.5 are exact enough to hand-verify in a test), the round-robin assignment algorithm (deliberately re-designed as a stored rotation pointer rather than the source's fragile re-derivation — see §3.1), leave-balance computation (the one deliberate improvement over source), and tenant-isolation checks on every new list/get endpoint (this project has hit and fixed the missing-`companyId`-check bug class **twice** already — Sampling and a 26-entity sweep — so every new repository function in this migration should be reviewed against that exact checklist before it ships, not after).

---

## 11. Risks

- **Scope**: four module areas, ~15 new tables, ~20 new API routes, RBAC, UI, tests — this is easily the largest single addition to the project since Phase 5C (Production). Building it all in one uninterrupted pass without incremental verification would be a real risk to quality, not just a time question.
- **Ambiguous source logic**: §3.1's round-robin and §6's Lead/BuyerEnquiry overlap are the two places where faithfully copying the source would import a real bug or a real category error — flagged rather than silently "fixed" or silently "copied," per the brief's own instruction not to simplify/remove a business rule without explaining why.
- **Feature-creep temptation**: the brief's own phase list (Territories, Tags, Customer Groups, Email Marketing, Salary Structures, Recruitment, Performance goals/KPIs beyond the source's simple version) names many CRM/HRMS concepts that sound plausible but **do not exist in the source at all** — building them would violate the brief's own "only include features that actually exist" rule.

---

## 12. Recommended next step

This report is the Phase 1–9/11/12/13 deliverable. Nothing has been implemented. Before any schema/migration/API/UI work begins, please resolve the two blocking decisions in §6 and §9(2)/(3), and confirm sequencing (§9-4) and HRMS priority (§9-5) — then implementation proceeds one module at a time (recommended order: **CRM → Marketing → HRMS**, since Marketing's own automation directly depends on CRM's Lead entity existing first, per the source's own `eq_mkt_sync_crm_leads()` dependency), each with its own design→build→verify pass and a working demo before moving to the next, matching how every other phase in this project has been built.

## 13. Decisions confirmed (2026-08-23)

- **§6 Lead model**: New `Lead` model, separate from `BuyerEnquiry`, with an optional forward FK into `BuyerEnquiry` for when a lead turns into a real style enquiry.
- **§9-4 Sequencing**: One module at a time — **CRM → Marketing → HRMS**, each fully built and verified before the next starts.
- **§9-5 HRMS scope**: Attendance + Leave only for v1. Payroll and KPI/Performance are deferred, not built.
- **§9-2 Deal ownership** (not separately asked, proceeding with the report's stated recommendation): both `assignedToUserId` (day-to-day owner) and optional `salesAgentId` (commission attribution).
- **§9-3 Campaign.spend**: deferred until the Marketing pass — decide then whether to derive from `CampaignDailyMetric` or store flat, matching whatever CSV-import behavior is actually built at that time.

**Now proceeding with CRM (Lead → Deal → Activity/Followup): schema → repository → service → API → RBAC → UI → tests → live verification.**

## 14. CRM module — complete (2026-08-24)

Built and verified end-to-end. Schema, RBAC, and code exactly match the design in §7-§9 above, with the confirmed decisions from §13.

- **Schema** (migration `add_crm_leads_deals`): `Lead` (reuses `EnquirySource` directly, `LeadPriority` computed at read time — never stored, closing the exact "two overlapping status concepts" wart flagged in §3.1), `Deal` (real `ALLOWED_TRANSITIONS` guard — QUALIFIED→PROPOSAL→NEGOTIATION→WON, LOST reachable from any open stage, both terminal — a deliberate improvement over the source's zero-validation stage field), `CrmActivity`/`CrmFollowup` (polymorphic via the existing `RelatedModule` enum, new `LEAD`/`DEAL` values added), `CrmRoundRobinState` (a real stored rotation pointer, fixing the source's fragile re-derive-from-last-lead approach). `SalesOrder.originatingDealId` added for CRM↔Sales traceability. `DocumentType.LEAD`/`DEAL` reuse the existing numbering service (`LEAD-2026-00001`, `DEAL-2026-00001`).
- **RBAC**: new `crm` module, granted to `MANAGEMENT` (view/export) and `MERCHANDISER` (view/create/edit/export/print) — `SUPER_ADMIN`/`VIEWER` inherited automatically via the existing `MODULES.map(...)` pattern. Required a `prisma db seed` re-run (RBAC config in `rbac.ts` only takes effect once seeded into the `permissions`/`role_permissions` tables) plus a dev-server restart (in-process `PermissionService` cache) — both already-documented gotchas in this project, hit again here for the same reasons.
- **Tenant-scoping discipline applied from day one, not retrofitted**: `CrmActivity`/`CrmFollowup`'s polymorphic `relatedRecordId` is checked against `actor.companyId` before every write (`assertRelatedRecordInCompany`), exactly the class of check this project has had to add after-the-fact twice before (Sampling's `addSampleMaterial`, then a 26-entity sweep). Verified live: a POST against a well-formed but nonexistent `relatedRecordId` returns a clean `404`, not a silent cross-tenant write.
- **12 new unit tests** (`lead.service.test.ts`, `deal.service.test.ts`; 116/116 project-wide): priority thresholds at both boundaries, duplicate-detection block + override, round-robin assignment including the wrap-around case, the auto-follow-up-on-create rule, every Deal stage-transition guard (legal forward move, illegal jump, terminal-state lock, WON→probability 100/LOST→probability 0), edit-blocked-once-closed, and the sales-leaderboard aggregation.
- **Verified live end-to-end** against the real dev DB (browser `<select>` automation hit the same known unreliability documented elsewhere in this project — switched to direct authenticated `fetch()` calls, the established fallback): created `LEAD-2026-00001` (score 85 → correctly computed `HOT`, auto-assigned via round-robin, auto-follow-up scheduled 24h out); confirmed the exact duplicate-email block and its message; created `DEAL-2026-00001` from that lead (weighted value `500,000 × 20% = 100,000` exact), walked it through the full guarded pipeline (blocked `QUALIFIED→WON` jump, `QUALIFIED→PROPOSAL→NEGOTIATION→WON`, weighted value correctly became the full `500,000` at 100% probability, edit correctly blocked once `WON`); confirmed `LOST` without a reason `400`s and with a reason succeeds with probability forced to `0`; confirmed the sales leaderboard correctly attributes pipeline value only to a deal's own explicit `assignedToUserId` (not the lead's); logged a real Activity (confirmed it bumped `Lead.lastActivityAt`) and completed a real Follow-up (confirmed `completedAt` set, and a second complete attempt on the same row correctly `409`s). List and detail pages for both Leads and Deals render correctly with zero new console errors. `npx tsc --noEmit`, `npm run lint`, `npm test` (116/116) all clean throughout.
- **Next**: Marketing (Campaigns, daily metrics, attribution, alerts) per the confirmed CRM → Marketing → HRMS sequencing — not started yet.

## 15. Marketing module — complete (2026-08-24)

Built and verified end-to-end on the `crm-marketing-hrms` branch. Applied the "derive, don't duplicate" discipline more thoroughly than the migration report originally flagged: not just `Campaign.spend` (the one field §9-3 called out), but `leads`/`qualifiedLeads`/`customers`/`revenue` too — none of these are stored columns; all are computed live in `campaign.service.ts` from `CampaignDailyMetric` and from `Lead`/`Deal` joined through the new `Lead.campaignId` FK.

- **Schema** (migration `add_marketing_campaigns`): `Campaign` (channel/status/approvalStatus enums, no stored metrics), `CampaignDailyMetric` (unique `(campaignId, metricDate)`, upserted — matches the source's own re-record-corrects-the-day behavior exactly), `CampaignAttribution` (multi-touch, a genuinely distinct concept from Lead itself — deliberately *not* the source's `eq_mkt_lead_map`, whose `lead_quality`/`conversion_status` fields were redundant with `Lead.priority`/`Lead.status` and would have reintroduced the exact "two sources of truth" bug class this project has fixed more than once), `CampaignAlert` (the 4 threshold rules ported byte-for-byte from the source's formulas). `Lead.campaignId` added (nullable FK, `campaignText` kept as the free-text fallback — the same dual-field shape as `BuyerEnquiryLine.productId`/`styleNameFreeText`). `DocumentType.CAMPAIGN` → prefix `CAMP`.
- **RBAC**: new `marketing` module, same grant shape as `crm` (`MANAGEMENT` view/export, `MERCHANDISER` view/create/edit/export/print) — required the same reseed + dev-server-restart pair as every RBAC addition in this project.
- **Automation**: `runMarketingAutomation()` ports all 4 source rules exactly — budget overspend/80%, low-ROAS (spend≥1000 gate)/ROAS-watch, high-CPL vs. same-channel peer benchmark (leads≥10 gate), low-conversion (leads≥20 gate) — each deduplicated per campaign while an alert of that type is still `OPEN`. No real background-job runner exists in this project, so — mirroring the source's own "Run Automation Now" manual button alongside its WP-Cron — this is exposed as a callable action on the Campaign detail page rather than only running on a schedule.
- **Real bug caught and fixed during live verification**: `CampaignDailyMetric.impressions`/`clicks` were originally modeled as Prisma `BigInt`, which crashed every read with `TypeError: Do not know how to serialize a BigInt` — `NextResponse.json()` (built on `JSON.stringify`) cannot serialize a native `BigInt`. Fixed by switching both columns to `Int` (migration `fix_campaign_metric_bigint_to_int`) — no real campaign at this business's scale needs more than ~2 billion impressions, and this avoids the serialization problem entirely rather than special-casing a `.toString()` conversion on every response.
- 9 new unit tests (`campaign.service.test.ts`, 125/125 project-wide): campaign-number generation, all 4 alert-threshold formulas (including the two minimum-spend/lead gates and the "no alert when comfortably under budget" negative case), alert deduplication, resolve + double-resolve rejection, and the dashboard's multi-campaign aggregation.
- **Verified live end-to-end** against the real dev DB: created `CAMP-2026-00001` (Meta Ads, ₹10,000 budget), recorded two real daily-metric rows (₹11,000 total spend — confirmed the exact BigInt crash above, fixed it, and confirmed the same calls now succeed and the rows had in fact already been written despite the earlier response-serialization crash); ran automation and got exactly the two expected alerts (`BUDGET_OVERSPEND` — "exceeded planned budget by ₹1000.00" — and `LOW_ROAS` — "below break-even ROAS: 0.00x"); confirmed re-running automation does not duplicate either alert; resolved one and confirmed a second resolve attempt on it correctly `409`s; linked the existing `LEAD-2026-00001` (from the CRM pass) to this campaign and added a real attribution record — confirmed the campaign's derived metrics immediately and correctly picked up that lead's already-`WON` `DEAL-2026-00001` (₹500,000 revenue, ROAS 45.45x), live proof the derive-not-duplicate design produces correct numbers automatically through the real Lead→Deal causal chain rather than needing anyone to remember to update a counter. Campaign list, detail, and the Marketing dashboard pages all render correctly with the live-computed numbers. `npx tsc --noEmit`, `npm run lint`, `npm test` (125/125) all clean throughout.
- **Deliberately not built in this pass** (documented, not an oversight): Meta/Google Ads live API sync and CSV import — the source's own real estate integration code, but genuine third-party HTTP/OAuth infrastructure work rather than core "business logic parity," and daily metrics can already be recorded manually through the UI in the meantime; a dedicated "Marketing Lists" or "Segments" entity — confirmed in §5 these don't exist as real, separate concepts in the source either (only the 3-value `lead_quality`, which Lead's own computed `priority` already covers).
- **Next**: HRMS (Attendance + Leave only, per the confirmed scope) — not started yet.

## 16. HRMS module — complete (2026-08-24)

Built and verified end-to-end on the `crm-marketing-hrms` branch. Scoped strictly to Attendance + Leave, per the confirmed decision — Payroll and KPI/Performance remain deliberately unbuilt.

- **Schema** (migrations `add_hrms_attendance_leave` + a same-day follow-up `add_leave_request_rejection_reason`): `AttendanceRecord` (unique `(employeeId, attendanceDate)`, `punchIn`/`punchOut` as full datetimes, matching the source exactly), `LeaveType` (flat `annualDays` quota, same shape as source), `LeaveRequest` (adds `rejectionReason`, distinct from the employee's own stated `reason` — a real gap in the initial schema pass, caught before any UI was built on top of it). `Employee.shiftId` added (nullable FK to the existing `ShiftMaster` — a schema column that existed since Phase 3 but was never wired to Employee until now) and surfaced as a real dropdown on the Employee master form, since it's what makes the late-attendance improvement below actually usable rather than theoretical.
- **The one deliberate improvement flagged in the migration report, actually built**: late-flag is computed live against the *employee's own* assigned shift (`computeIsLate()`), not the source's single hardcoded 10:15 cutoff for every employee company-wide — verified live with two employees on different shifts. A `null` (not `false`) result when an employee has no shift assigned is a real, deliberate third state — displayed distinctly in the UI ("No Shift") rather than defaulting to "On Time," which would have silently misrepresented an unconfigured employee as confirmed punctual (caught and fixed during live verification, see below).
- **The second deliberate improvement**: a real running leave-balance ledger (`getLeaveBalance()`), computed live from every `APPROVED` request overlapping a calendar year — the source has no balance tracking at all, so `approveLeaveRequest()` closes the "obvious real-world gap" the report called out: approving a request that would push usage over the leave type's `annualDays` is now a hard `409 LEAVE_BALANCE_EXCEEDED`, not silently allowed. `annualDays = 0` is treated as "unlimited/not tracked" so an unconfigured leave type never blocks approval.
- **Self-approval guard deliberately NOT applied**: unlike Sampling/Sales-Order/Purchase-Order approvals elsewhere in this project, `approveLeaveRequest()`/`rejectLeaveRequest()` don't check creator-vs-approver, because this module has no self-service employee portal — `createdByUserId` is whichever admin logged the request on an employee's behalf, not the employee themselves, so "did the creator approve their own request" isn't a meaningful check against this data model. Documented here rather than silently omitted.
- **RBAC**: two new modules, `hrms_attendance` and `hrms_leave` (split the way `masters_core`/`masters_finance` already are in this project), granted to `MANAGEMENT` only (view/create/edit[/approve/reject for leave]) — no dedicated HR role exists yet in this system's role list, so the closest existing "manager" role owns this for now, matching the same default already used for `crm`/`marketing`.
- 13 new unit tests (`attendance.service.test.ts`, `leave.service.test.ts`; 138/138 project-wide): every branch of the 3-state late-flag (on time / late / indeterminate-no-shift), the leave-balance sum including a year-boundary-clipping case, the balance-exceeded block, the `annualDays=0` unlimited case, double-approve/reject rejection, and rejection-reason storage.
- **Verified live end-to-end** against the real dev DB: assigned "General Shift" (09:00 start) to a real employee, recorded a 9:16 AM punch-in and confirmed `isLate: true`; recorded a second employee with no shift assigned and confirmed `isLate: null`, initially mis-rendered as "On Time" by the list page — a real UI bug caught and fixed live to show "No Shift" instead, distinguishing "confirmed punctual" from "can't tell"; confirmed the attendance summary counts (present/late/missing) matched exactly. Created a Leave Type (Casual Leave, 12 annual days), approved a 5-day request (7 remaining), then confirmed a second 10-day request against the same employee/type/year correctly `409`s with the exact expected message through both a direct API call and the real "Approve" button in the UI; confirmed rejection requires a non-empty reason (`400` without one) and stores it separately from the employee's own leave reason; confirmed both a second approve and the balance-check math via the standalone balance endpoint all agree. `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138) all clean throughout.
- **Real TypeScript inference gotcha hit and fixed, worth remembering project-wide**: `AttendanceRepository.findMany`'s original signature took a generic `Omit<Prisma.AttendanceRecordFindManyArgs, "where">` for its second parameter — structurally identical to the pattern already used by `LeadRepository`/`DealRepository`/etc. elsewhere in this project — but here it silently defeated Prisma's payload-type inference: because `include`/`select` remain present (as optional keys) in that `Omit` type, TypeScript couldn't statically prove the final spread wouldn't override the literal `include: DETAIL_INCLUDE`, so it fell back to the base (relation-less) model type. This had been invisible in every earlier module because none of their `decorate*()` helpers required a *relation* field in their generic constraint (only plain scalars) — `decorateAttendance()` was the first to require `employee.shift`, which is what exposed it. Fixed by narrowing the repository parameter to an explicit `{ orderBy?, skip?, take? }` shape instead of the generic `Omit<FindManyArgs, "where">`. Not retroactively applied to the other modules since they don't currently hit this failure mode, but worth checking this exact pattern first if a future module's list decorator needs a relation field and TypeScript unexpectedly reports it missing.
- **Deliberately not built** (documented, matching the confirmed scope): Payroll (flat source columns, no real calculation engine to port), KPI/Performance reviews, Recruitment (confirmed absent in the source entirely), any employee/manager self-service portal (the source's `eq_hrms_employee_portal`/`eq_hrms_manager_portal` — a materially larger, auth-linked feature that wasn't part of "Attendance + Leave only").

**All three confirmed modules of this migration (CRM, Marketing, HRMS) are now built and verified.** The only remaining item from the original brief's four areas is "Sales" as a distinct concept — already addressed structurally in the CRM pass via `Deal`/`SalesOrder.originatingDealId`, since the source itself never had a separate Sales module beyond CRM's own Deals feeding Finance's invoices (see §2.2).
