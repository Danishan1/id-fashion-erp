# Sales & Marketing — Phase 11 Marketing assets, templates and content (2026-11-05)

Spec: `docs/sales-marketing/ref/11.md`. Scope confirmed with the user on 2026-11-05:

- **Templates:** extend the existing CRM message templates with a marketing approval step. There is no second template library.
- **Email format:** plain text only. There is no HTML email, rich-text editor or HTML sanitiser.
- **Assets:** an asset library, plus approved PDFs and images sent as email attachments (SMTP and Brevo).
- **Approval:** a new permission module `marketing_content` with approve / reject. The author never approves their own version.

Out of scope (later phases): promotions and budgets (12), attribution (13), bulk tools (14), AI content (18). Also out of scope: HTML email, WhatsApp media headers and translations.

## 1. What existed (reused, not rebuilt)

| Need | Reused |
|---|---|
| File storage | `src/core/file-storage/FileStorage.ts`: private folder outside `public/` (`FILE_STORAGE_ROOT`, default `./uploads`), magic-byte content check (`file-type`), random storage keys, 20 MB cap. It gained an optional per-caller allow-list and lower size limit; the default behaviour is unchanged. |
| Image metadata | `sharp` (already a dependency): width and height, plus rejecting unreadable images. |
| Templates, variables, rendering | CRM templates (`src/modules/crm/templates`): versions, the allow-listed `{{entity.field\|fallback}}` variables, deterministic plain-text rendering, and the channel rules (subject, SMS length and segments, WhatsApp provider fields). |
| Campaigns, audiences, delivery | Phase 08 campaigns, Phase 09 snapshots, Phase 10 connections, runs, adapters and the worker. |
| Audit, history, notices | `writeAuditLog`, campaign history (`sales_performance_events`), in-app notifications. |

The ERP has **no shared approval engine**: each module does its own approve step with a self-approval check. Phase 11 follows that pattern with one review table for all content kinds, not one per kind.

There is **no malware scanner**. Every file version is stored as `NOT_SCANNED` and shown as "Not scanned (no scanner configured)", never as clean.

## 2. Concepts kept separate

| Concept | Where |
|---|---|
| Reusable asset | `marketing_assets` (metadata, tags, owner, expiry, pointers) |
| Asset version (the file) | `marketing_asset_versions`, **immutable** (DB trigger) |
| Reusable template + its versions | CRM `crm_message_templates` / `crm_message_template_versions` (unchanged) |
| Approval decision | `marketing_content_reviews` (one per version) plus `marketing_content_review_events` (history) |
| Campaign-specific content | `marketing_campaign_contents` (made from a template; the template is never edited) |
| Content version | `marketing_campaign_content_versions` plus pinned files `marketing_content_version_assets`, both **immutable** |
| Provider-ready payload | Built per recipient by Phase 10 (`delivery-render.ts` + adapter) from the frozen version ids on the run |

## 3. Data model (migration `20261106120000_marketing_content_phase11`, rollback in `prisma/rollback/`)

**Assets:**

- `marketing_assets`:
  - unique code per company (`AST-00001`…);
  - type IMAGE, LOGO, DOCUMENT or VIDEO (CHECK);
  - tags (GIN index), alt text, usage rights, expiry date, owner;
  - status ACTIVE or ARCHIVED;
  - `current_version_id`, plus `approved_version_id` (the newest approved version);
  - an optimistic `version` column.
- `marketing_asset_versions`:
  - storage key (unique), original name (cleaned), MIME type, size, SHA-256 (CHECK), width and height, scan status, change note, author;
  - no update or delete is possible (trigger).

**Reviews:**

- `marketing_content_reviews`:
  - one row per (subject type, subject id), where the subject is ASSET_VERSION, TEMPLATE_VERSION or CONTENT_VERSION;
  - status PENDING, APPROVED, CHANGES_REQUESTED, REJECTED or WITHDRAWN;
  - author, submitter, decider, comment.
- CHECKs:
  - a decision has a decider and a time;
  - the decider ≠ the author.
- A trigger makes a decided review (approved, rejected, changes requested) final.

**Campaign content:**

- `marketing_campaign_contents`: campaign, channel, locale (CHECK), source template, ACTIVE / ARCHIVED, current and approved version pointers, optimistic `version`.
- `marketing_campaign_content_versions`: subject, body, variables, provider metadata, and the source template version.
- `marketing_content_version_assets`: the asset versions pinned to a content version, in order.

**Phase 10 tables:**

- `marketing_campaign_channels.content_id`. The single unique index became two partial uniques: (campaign, connection, template) without content, and (campaign, connection, content) with it.
- `marketing_delivery_runs.content_version_id` and `locale`.

**Permission module `marketing_content`:**

| Role | Actions |
|---|---|
| SUPER_ADMIN | all |
| MANAGEMENT | view, create, edit, delete (= archive), approve, reject, export |
| MERCHANDISER | view, create, edit |
| VIEWER | view |

## 4. Rules

**Uploads:**

- The declared type must be one of the asset type's allowed types; SVG, HTML and scripts are never accepted.
- The content is fingerprinted and must match the declared type.
- Size limit: `MARKETING_ASSET_MAX_MB` (default and maximum 20).
- The storage key is random with an extension taken from the checked type; the user's name is never used as a path.
- The original name is reduced to a safe display name.
- Images must decode.
- A failed database write removes the stored file.
- An identical file is reported as a duplicate. In the same asset it is refused ("identical to version N"); in another asset the upload is kept, with a warning.

**Downloads and previews:**

- Only through `/api/v1/sales-marketing/content/assets/versions/{id}/file`, which needs a session, `marketing_content.view` and the same company.
- Headers: `X-Content-Type-Options: nosniff`, a sandboxing CSP, and RFC 6266 filenames.
- Inline display only for images, PDF and video. PDFs open in a new tab rather than an embedded frame.

**Versions:**

- Replacing a file creates a new asset version, and saving content creates a new content version.
- Nothing approved or frozen can change: database triggers enforce it, and the tests try it.
- Optimistic `version` checks stop two people overwriting each other: the second save gets a conflict.

**Reviews:**

- Lifecycle: Draft (no row) → submit → PENDING → approve / request changes / reject. Withdraw → WITHDRAWN → submit again.
- Request changes and reject need a reason. Changes are made in a **new** version.
- **The author or the submitter can never decide** (service and CHECK). With only one approver user, content can't be approved; that is intended.
- Approving campaign content also needs every attached asset version to be approved, its asset active and not expired.
- Approving an asset or content version moves its "approved" pointer only forward. An older approval stays approved for history.

**What a campaign sends:**

- A channel that sends a **template** uses the template's newest version approved for marketing, and the template must be ACTIVE in the CRM.
- A channel that sends **campaign content** uses that content's newest approved version and the asset versions pinned to it.
- A newer draft never replaces the approved version until it is itself approved.

**Runs:**

- A run stores `template_version_id`, `content_version_id` and `locale` when it starts. Dispatch loads exactly those (`loadRunContent`).
- A later edit or approval never changes a started run: the test approves v4 mid-run, and the run still sends v2 with its brochure.
- Before each dispatch slice, attachments are checked again (approved, active, unexpired, allowed for the provider). A problem stops the run with a reason.

**Personalisation:**

- Only the allow-listed contact, company and user variables (the Phase 10 rule), inserted as plain text and never re-parsed.
- **A variable with no value and no fallback skips that recipient** (`RENDER_FAILED`) instead of sending a blank.
- Editors and previews show which variables lack a fallback. Authors write `{{contact.first_name|there}}`.

**Previews:**

- Sample data, or a CRM contact the viewer can see (needs CRM view, through the CRM's own visibility check).
- Previews never send. Test sends stay the explicit Phase 10 action and use the newest text, marked `[TEST]`.

**Archiving:**

- An asset can't be archived while live content uses it. Live means the current or approved version of active content in an open campaign, or a version frozen by a run that is still going.
- Archived assets disappear from pickers, keep their files and history, and can be restored.
- Content can't be archived while one of its runs is open.

**Expiry:** an asset past its "usable until" date blocks approval and sending of content that attaches it.

## 5. Channels and formats

| Channel / provider | Text | Attachments |
|---|---|---|
| Email via SMTP | plain text | yes: approved PDF / JPEG / PNG / WebP / GIF, up to 5 and 10 MB in total |
| Email via Brevo | plain text | yes (base64 `attachment`), same limits |
| SMS via MSG91 | plain text (DLT template id) | refused |
| WhatsApp Cloud API | approved Meta template | refused (media headers not built) |

Validation happens at three levels, and they are kept distinct:

- **CRM template rules:** subject, length, SMS segments, provider fields.
- **Delivery rules:** allowed variable sources, attachments.
- **The provider adapter's own `validateMessage`:** DLT id, approved WhatsApp name, attachment limits.

"Approved" in this module always means **approved internally**. The app never claims a provider (Meta, DLT) approved a template; those references are typed in by the user.

Video assets are stored and previewed only. Nothing sends them.

## 6. Localization

Minimal by design (no translation infrastructure exists):

- Campaign content has a `locale` (BCP 47, CHECK). WhatsApp templates carry their language in provider metadata.
- A run records the locale it used.
- There are no linked translations and no fallback between languages. One piece of content per language is the way to do it today.
- No machine translation.

## 7. Screens

- **Sales & Marketing → Content Library** (`/sales-marketing/content`):
  - **Assets:** grid with search, type, approval, status and tag filters; upload with metadata.
  - **Templates:** CRM templates with their current review and the version campaigns send.
  - **Reviews:** queue by status and kind.
- **Asset page:**
  - preview of the selected version, details, versions with review actions;
  - replace the file (new version), edit metadata;
  - "used by", duplicate warning, archive / restore.
- **Template page:** each version with a sample preview, delivery problems, variables without fallback, review actions, usage, and a link to CRM → Templates for editing.
- **Campaign page → Content:** list of the campaign's content; new content from a template.
- **Content page:**
  - editor that saves a new version, with a variable picker and provider fields;
  - attachments from approved library files, language, change note;
  - versions with review actions;
  - preview with sample data or a contact;
  - which channels and runs used which version.
- **Campaign page → Channels & delivery:** a channel sends either a template as it is or the campaign's content, and shows exactly which approved version and files it will send.
- **Run page:** content name, version and attachments.

## 8. Code map

| Module (`src/modules/sales-marketing/content/`) | Purpose |
|---|---|
| `content-registry.ts` | Client-safe: asset types / MIME, limits, review statuses / actions, schemas |
| `content-common.ts` | Audit, campaign history, notifications, names |
| `content-review.service.ts` | Submit / withdraw / approve / request changes / reject, history, queue |
| `asset.service.ts` | Upload, versions, metadata, archive, usage, search, file reads |
| `marketing-template.service.ts` | CRM templates with marketing review |
| `campaign-content.service.ts` | Campaign content, versions, attachments, preview, archive |
| `content-resolver.ts` | **The interface to Phase 10**: what a channel would send, run content, attachment checks and bytes |

Phase 10 changed in these places:

- `delivery-run.service.ts`: channel source, resolver at list / start / test, frozen ids, run detail.
- `delivery-engine.ts`: frozen content, attachments, the strict variable rule.
- `delivery-render.ts`: `strictRenderProblems`; the entity set moved to `delivery-render-entities.ts`.
- Provider contract: `attachments`.
- Registry: an `attachments` capability.
- Adapters: SMTP / Brevo send attachments; MSG91 / WhatsApp refuse them.

UI: `src/components/sales-marketing/content/`. API: `src/app/api/v1/sales-marketing/content/**`, `campaigns/[id]/contents`.

## 9. Setup

1. Run `npx prisma migrate deploy`, `npx prisma generate` and `node scripts/sync-permission-catalog.mjs`, then restart the app and the worker. No new npm packages.
2. **Storage:**
   - `FILE_STORAGE_ROOT`: as for all attachments; must be a persistent, private disk and backed up.
   - `MARKETING_ASSET_MAX_MB` (optional, ≤ 20).
3. **Existing Phase 10 channels that send a template stop working until that template's version is approved** in Content Library → Templates, by someone other than its author. This is intended (approval before sending).
4. Grant `marketing_content.approve` / `reject` to the people who should approve. MANAGEMENT has them by default.

## 10. Limitations (known)

- **No malware scanning.** Files are content-checked, private, served with nosniff and a sandbox CSP, but not scanned.
- **Storage:** local disk only (the existing storage layer; S3 is a later swap behind `FileStorage`). No CDN or signed public URLs, which is why WhatsApp media isn't possible yet.
- **Plain-text email only.** Images go as attachments, not inline.
- **No side-by-side version compare.** Each version is viewable.
- **Template editing stays in the CRM.** Marketing users without CRM access can review but not edit template text; they work in campaign content instead.
- **Approver notifications** go to every user with `marketing_content.approve` in the company; there is no routing by team.
- **Review queue paging:** a page can show fewer rows than its page size, because rows the viewer can't see (other teams' campaign content) are dropped after paging.
- **Localization** is metadata only (§6).
- **Not tested in a browser** in the sandbox (no app server here).

## 11. Acceptance criteria (spec `ref/11.md` §23)

| Criterion | Status |
|---|---|
| Upload, organize, search, preview, manage assets | Done |
| Size, type, access, storage security | Done (no malware scan, documented) |
| Asset versions keep historical references | Done (immutable versions; runs keep pinned files) |
| Create, edit, reuse, archive templates | Done through the CRM template library + marketing review; campaign content for per-campaign wording |
| Variables allow-listed, safe rendering | Done (CRM engine; plain text; no expressions) |
| Missing required variables / invalid content caught before delivery | Done (save-time validation, preview, strict rule at send) |
| Channel validation uses Phase 10 adapters | Done |
| Approval tied to an immutable version | Done (DB triggers + CHECK) |
| Approved / scheduled content not changed by later edits | Done (tested mid-run) |
| Campaign content references templates and assets | Done |
| Phase 10 gets validated content and version ids without duplicating delivery | Done (`content-resolver.ts`) |
| Previews never send | Done (tested) |
| Permissions, tenant isolation, audit, privacy | Done (cross-company tests; audit rows; masked data unchanged) |
| References consistent through archive / versions | Done |
| Tests | Done (see §12) |
| Documentation | This file |
| Phases 01–10 still work | Full suite run; Phase 10 test updated for the new approval rule |
| No duplicate CRM / campaign / delivery / document / approval module | Respected |
| No Phase 12+ features | Respected |

## 12. Verification (sandbox, 2026-11-05)

- **Type-check:** clean on the Sales & Marketing slice plus the content and delivery paths (`tsconfig.check-p9.json`, sandbox only — the full `tsc` exceeds the sandbox memory).
- **ESLint:** 0 errors / 0 warnings on all new and changed files.
- **Unit tests:** 13/13 (`content.unit.test.ts`):
  - type allow-list (no SVG / HTML), size limit, file-name cleaning (paths, quotes, control characters), metadata validation;
  - review state machine and which permission decides;
  - content version schema;
  - variables without fallback; the strict missing-value rule; values inserted as plain text;
  - attachment rules per provider; Brevo base64 attachment.
- **Integration tests:** 7/7 (`content.integration.test.ts`) on a migrated + seeded Postgres, with files in a temporary folder:
  - Real PNG upload: random key, dimensions, cleaned name.
  - Refused files leave no stored file behind: PDF bytes declared as PNG, SVG with a script, an EXE header declared as PDF, HTML.
  - Cross-company reads refused.
  - Immutable versions (DB refuses an update); same-file re-upload refused; type change refused.
  - Reviews:
    - the author can't approve;
    - rejecting needs a reason;
    - a decided review is final (service and trigger);
    - "changes requested" keeps the old approved version in use.
  - A template must be approved before a run can start.
  - Campaign content:
    - "nothing changed" and invalid or unsafe variables are refused;
    - a stale save conflicts; the DB refuses tampering;
    - approval is refused while an attached asset isn't approved;
    - preview with sample data and with a contact flags a missing value and sends nothing.
  - A run frozen on v2 still sends v2 (with the brochure PDF, base64) after v4 is approved mid-run.
  - The contact without a value is skipped (`RENDER_FAILED`).
  - Archiving refused while in use; expiry blocks approval; SMS can't carry files; an unused asset archives.
- **Regression:**
  - The Phase 10 integration test was updated for the new rule: a second user approves the template version before sending.
  - Delivery + content tests: 61/61.
  - Full suite with the database: **4,230 passed, 9 skipped (pre-existing skipped files), 0 failed**.
- **Not done in the sandbox:** a click-through in a browser (no app server here) and real provider sends (no credentials, as in Phase 10).

## 13. Ready for Phase 12

Promotions and budgets can:

- attach offer content as campaign content (a version, an approval, pinned files);
- reference the approved content version ids that runs already record.

Asset usage and campaign history give the audit trail a budget review needs. Nothing about offers, discounts or budgets was built here.
