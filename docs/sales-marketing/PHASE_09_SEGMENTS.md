# Sales & Marketing — Phase 09 Audience segmentation (2026-11-05)

Spec: `ref/09.md`. Plan: `RELEASE_PLAN.md`. Scope confirmed 2026-11-05:

- **Core.** Dynamic and static segments; a criteria builder with AND / OR groups (one level); live preview with counts; evaluation in the background; numbered, frozen definition versions; snapshots of who was in a segment and why each record was left out; contact consent / DND exclusions; use in campaigns.
- **Sources:** CRM contacts, CRM companies, CRM leads, ERP customers. One source per segment.
- **Campaigns:** one or more *include* segments plus optional *exclude* segments, each optionally pinned to a snapshot. The campaign shows the combined, de-duplicated count.
- **Refresh:** manual, plus nightly for segments set to "Every night".

**Not in this phase:** sending anything (Phase 10 — choosing an audience never sends, publishes or launches), nested groups deeper than one level, cross-source segments, segment-of-segments, saved criteria templates, lookalike / AI audiences, CSV import of static members.

## 1. What existed (reused, not rebuilt)

CRM contacts / companies / leads and their visibility rule (`getCrmRecordScope` + `crmOwnerWhere`), CRM tags, Phase 04 contact consents (`crm_contact_consents`, channel or `ALL`), ERP customers and the Phase 05 booked-order rule (`bookedOrderWhere` / `bookedOrderSql`), Phase 08 campaigns, `sales_performance_events` for history (entity `SEGMENT`, and `CAMPAIGN` for audience changes), the audit log, CRM business dates (Asia/Kolkata), the BullMQ worker, `DataTable`. No CRM data is copied: segments store record ids only.

## 2. Data model (migration `20261105090000_marketing_segments_phase9`)

| Table | Purpose |
|---|---|
| `marketing_segments` | code (unique per company), name, purpose, source, type DYNAMIC / STATIC, status DRAFT / ACTIVE / PAUSED / ARCHIVED, owner, refresh MANUAL / NIGHTLY, current version number, summary of the latest completed snapshot, `idempotency_key`, `version` (optimistic lock). |
| `marketing_segment_versions` | one row per definition: criteria JSON, exclusion criteria JSON, eligibility channel, canonical hash, change note. A DB trigger refuses UPDATE — a change is always version N+1. |
| `marketing_segment_members` | hand-picked INCLUDED (static) or EXCLUDED (both types) records, with reason; removal sets `removed_at` (history kept). Partial unique index: one live row per record and kind. |
| `marketing_segment_evaluations` | a snapshot of one version: QUEUED → RUNNING → COMPLETED / FAILED / SUPERSEDED, counts, run-as user, kept flag + label, `entries_purged_at`. Partial unique index: one QUEUED / RUNNING evaluation per segment. |
| `marketing_segment_snapshot_entries` | one row per record per snapshot: outcome INCLUDED / EXCLUDED / INELIGIBLE, origin CRITERIA / STATIC, reason. |
| `marketing_campaign_audiences` | campaign × segment, role INCLUDE / EXCLUDE, optional pinned evaluation. |

Permission module `marketing_segments` (in the `SALES_MARKETING` package): view (own / team / created), view_all, create, edit (definitions, members, refresh, activate / pause), delete (archive), export. MANAGEMENT: view, view_all, create, edit, delete, export. MERCHANDISER: view, create, edit, export.

## 3. Criteria semantics

- Fields and operators come only from `segment-registry.ts` (`SEGMENT_FIELDS`, `OPERATORS_BY_TYPE`). The server re-validates every stored definition before running it; nothing user-typed is ever put into SQL (values are always parameters; the only raw SQL is fixed, parametrised aggregates for customer order value / count).
- Text ignores case. Positive operators never match an empty value; negative operators (not equals, does not contain, not in) **do** match empty values ("no country" counts as "not India").
- Dates are Asia/Kolkata calendar days: before / after are exclusive, between includes both days, "in the last N days" = today and the N-1 days before.
- Customer "last order date", "booked order value" and "booked order count" use the Phase 05 booked rule (Confirmed … Closed, or On hold from a booked status).
- Limits: 10 groups, 20 conditions per group, 200 values in a list. Contradictions inside an ALL group (e.g. country = India AND country = Germany) are reported as errors.
- Zero groups = every available record of the source.

## 4. Who is a member

Every record ends with exactly one outcome, checked in this order:

1. **Not available** — archived / merged CRM record, deleted or inactive customer → excluded (`SOURCE_UNAVAILABLE`). Such records are never part of a segment.
2. **Not accessible** — outside the CRM visibility of the person the run is for → excluded (`NOT_ACCESSIBLE`). Customer segments need `masters_core.view`.
3. **Manual exclusion** (`MANUAL_EXCLUSION`), then **exclusion rule** (`EXCLUSION_RULE`) → excluded.
4. **Eligibility channel** (optional: Email / WhatsApp / SMS / Phone): no address for it → ineligible (`NO_ADDRESS`); for contacts, an opt-out / DND / bounce on that channel or on "all channels" → ineligible (`CONSENT_RESTRICTED`).
5. Otherwise **included**.

Consent is stored only for CRM contacts. For companies, leads and customers the screens say clearly that consent can't be verified (`consentCheck` = NOT_AVAILABLE) — they are never presented as cleared for marketing messages. A segment with no channel shows NOT_CHECKED.

Dynamic members = matches of the rules minus exclusions minus ineligible. Static members = the hand-picked list, run through the same checks (a hand-picked record that was later archived drops out with a reason).

## 5. Preview, evaluation and snapshots

- **Preview** counts the saved definition (or the unsaved draft in the editor) live, with the viewer's own access, under a 10 s statement timeout. It writes nothing and is labelled "Live preview — not a snapshot".
- **Evaluation** runs in the worker (`segment.evaluate`, queue `marketing-segments-<db hash>`); if Redis isn't reachable the API runs it after the response. It claims QUEUED → RUNNING, classifies records in batches of 1000 and finishes under a row lock on the segment. If the definition changed meanwhile the result is SUPERSEDED (entries dropped). Entries can only be read once COMPLETED, so a half-written snapshot is never shown as complete. A failed run leaves no entries and keeps the previous snapshot as the current one. Only one evaluation per segment can be queued / running; asking again returns the existing one. Saving a new definition supersedes a still-queued run of the old version.
- The segment's summary (member count, last evaluated) only moves forward to a newer run, so an older run finishing late can't overwrite it.
- Runs use the live access of the requester (nightly: the owner), re-checked when the run starts.
- Limits: 200,000 matching records per dynamic run, 20,000 static members, 5,000 manual exclusions.
- **Retention:** the newest 5 completed snapshots keep their member lists, plus any snapshot marked *Keep* and any pinned by a campaign; older ones keep only their counts (`entries_purged_at`). Stale RUNNING runs (> 30 min, lost worker) are failed by the recovery job (every 10 min), which also re-queues lost QUEUED runs.
- **Nightly:** 02:00 Asia/Kolkata (`segment.nightly`), active segments with refresh = Every night, idempotency key `nightly:<day>`.

## 6. Campaign audience

On the campaign page: add active segments of one record type as Include or Exclude, optionally pinning their latest snapshot ("Follow latest snapshot" un-pins). The combined count is computed from snapshots only (ids, no personal data): included rows, duplicates removed, removed by exclusion segments, audience. If any segment in use has no complete snapshot the count isn't shown and the page says which to refresh. A segment used by a planned or running campaign can't be archived. Completed / cancelled campaigns can't change their audience. The page states that being in an audience is not permission to contact.

## 7. Screens

Sales & Marketing → *Audience Segments*: list (filters, member count, last evaluated, status), New segment, detail with tabs Definition (criteria builder, exclusion rules, channel, versions), Preview, Members (static members and manual exclusions, search + add), Snapshots (refresh, keep / label, entries by outcome with reasons), History. Campaign detail: *Audience* panel.

## 8. Code map

| Area | Files |
|---|---|
| Schema | `prisma/migrations/20261105090000_marketing_segments_phase9/` (rollback `prisma/rollback/20261105090000_marketing_segments_phase9.down.sql`) |
| Registry (client-safe) | `src/modules/sales-marketing/segments/segment-registry.ts` |
| Query builder | `segments/segment-query.ts` (field → column allow-list, access, eligibility, classification) |
| Services | `segment-common.ts` (visibility, history, audit, hashing, display rows — names only), `segment.service.ts` (CRUD, versions, lifecycle, members, preview), `segment-evaluation.service.ts` (evaluate, retention, recovery, nightly, snapshots), `campaign-audience.service.ts`, `segment-options.service.ts` |
| Worker | `segments/segment-jobs.worker.ts`, started from `src/core/jobs/worker.ts` |
| APIs | `/api/v1/sales-marketing/segments` (+ `options`, `validate`, `audience-options`, `[id]`, `[id]/definition`, `[id]/actions/[action]`, `[id]/duplicate`, `[id]/preview`, `[id]/members`, `[id]/candidates`, `[id]/evaluations`, `evaluations/[evaluationId]` (+ `/entries`, `/keep`)); `/api/v1/sales-marketing/campaigns/[id]/audience` (+ `/[audienceId]`) |
| Screens | `/sales-marketing/segments`, `/new`, `/[id]`; `components/sales-marketing/segments/*`; `CampaignAudiencePanel` on the campaign page |
| Tests | `segments.unit.test.ts` (allow-list, injection-looking names, types, query shape, IST days, eligibility, classification order), `segments.integration.test.ts` (real DB) |

## 9. Limitations (known)

- One level of groups; no OR across sources; no segment-of-segments.
- Consent exists only for CRM contacts.
- Snapshots record ids and reasons, not a copy of the record; names shown later are the record's current name (hidden if the viewer can no longer see it).
- Static members are added by search (max 500 at a time); no CSV import.
- Retention count (5) is a constant, not a setting.

## 10. Verification (sandbox, 2026-11-05)

- Type-check clean (Phase 09 slice of the project, `tsconfig.check-p9.json`, sandbox only — the full `tsc` is killed by the sandbox memory limit). ESLint: 0 errors on the new files.
- Tests: unit 23/23; integration 6/6 on a freshly migrated + seeded Postgres — unsafe field refused, idempotent create, outsider can't see the segment; preview classifies six contacts exactly (2 members, rule + manual exclusions, no-address + DND ineligible) and writes nothing; evaluation snapshot with reasons, second request returns the queued one, a definition change supersedes it, old snapshot keeps its v1 entries, new one evaluates v2; a restricted user's segment only contains records they can see; static members de-duplicated, retention purges only the oldest unkept snapshot (kept one survives, purged one refuses its list), an archived contact drops out with SOURCE_UNAVAILABLE without changing older snapshots; campaign audience include + include = 4 of 5 rows (1 duplicate), include + exclude = 3 (1 removed), archive refused while used, other record type refused. All Sales & Marketing tests 169/169 with the DB.
- Not done in the sandbox: a browser walk-through on the dev DB (no app running here) — see the hand-over checklist.
