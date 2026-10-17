# CRM Phase 12 — Message Templates

Status: implemented, tested and verified (2026-10-09). Phase 13 is not started.

Reusable, provider-neutral templates for email, SMS and WhatsApp, with merge fields, immutable versions, categories, preview, test send and use from the Inbox. It is one shared service that future sequences, workflows, reminders and campaigns call; it is not a separate communication system.

```
CRM template (crm_message_templates) ── current version ──► immutable versions (crm_message_template_versions)
        │
        ▼  renderTemplate(templateId, context)       ← one parser/renderer (template-engine.ts)
Rendered subject + text + issues
        │
        ▼  Phase 11 conversation service (permission, capabilities, DND)   or   test send
ChannelProvider adapter (src/core/communication) ──► email / SMS / WhatsApp provider (via the channel's relay)
```

## 1. Existing systems inspected

- **Templates and merge fields:** none existed. There is no message-template model, no token replacement, no email/SMTP, SMS or WhatsApp service. The only "templates" in the schema are AI-designer garment images.
- **Communication:** the Phase 11 `ChannelProvider` contract plus the generic signed-webhook provider. These are the only sending path.
- **Conversations:** the Phase 11 conversation services, Inbox composer, messages and events.
- **Master data:** `crm_option_values` (admin-managed lists with create, rename, deactivate and order, plus an audit trail).
- **Records:** contacts, companies, opportunities (stage, pipeline, owner), leads (status, source), appointments (Phase 10 `crm_activities` rows of type APPOINTMENT), ERP users.
- **Opportunity ERP links:** there is no ERP quotation module (Phase 06 `QUOTATION_NOT_AVAILABLE`).
- **Other ERP infrastructure:** RBAC (`crm`, `crm_settings`), `AuditLog` + `writeAuditLog`, `runCrmMutation` + `crm_events`, `CrmTimeline`, `crmRoute`, `CrmTable` / `DataTable`, `CrmRecordPicker`, the capture rate limiter, the date and currency formatters, `crm-timezone`.

## 2. Existing systems reused

| Need | Reused |
|---|---|
| Sending (test and Inbox) | Phase 11 `ChannelProvider` adapters. The contract only gained optional fields: `OutboundMessage.template` / `test` and `ChannelProvider.validateTemplate?`. |
| Inbox send | `sendConversationMessage` → `prepareSend` (permission, capabilities, DND), unchanged. The template is resolved after those checks. |
| Categories | `crm_option_values` with list key `template_category`, through the existing option-values service, API and audit. No category table. |
| Records | Contacts, companies, opportunities, leads, appointments, ERP users, read through `assertCrmEntityAccess` (same visibility as their pages). |
| History | `runCrmMutation` → `crm_events` (new entity type `TEMPLATE`, events `template.*`) and `AuditLog`. Shown with `CrmTimeline`. |
| Permissions | Existing `crm.view` / `create` / `edit` and `crm_settings.edit`. No new roles or permissions. |
| UI | `CrmTable`, `CrmPageHeader`, `CrmRecordPicker`, `Modal` / `ConfirmModal`, `CrmTimeline`, toasts, `crmRequest`. |
| Rate limiting | `assertCaptureRateLimit` (test sends). |
| Formatting | `formatCurrency` (en-IN), `crm-timezone` (`formatZonedDate` / `formatZonedTime` / `zoneAbbreviation`). |

## 3. Files created

**Module — `src/modules/crm/templates/`**

| File | Purpose |
|---|---|
| `template-registry.ts` | Client-safe: statuses, actions, per-channel rules, provider fields, the variable registry with samples, the category list, issue types. |
| `template-engine.ts` | Client-safe: the one parser / renderer / validator; SMS part counting; caret insertion. |
| `template-context.ts` | Server: record ids → value map, one query per record type. |
| `template.schema.ts` | Zod schemas. |
| `template-usage.ts` | Usage-provider registry; Phase 12 registers "Messages sent from the Inbox". |
| `crm-templates.service.ts` | CRUD, versions, lifecycle, preview / validate, render, test send, the Inbox hook, and the `TemplateService` facade. |

Tests in the module: `templates.unit.test.ts`, `templates.integration.test.ts`.

**API — `src/app/api/v1/crm/templates/`**

- `route.ts`, `meta/`, `preview/`, `validate/`
- `[id]/route.ts`
- `[id]/duplicate|activate|deactivate|archive|restore/`
- `[id]/versions/`, `[id]/versions/[versionId]/`, `[id]/versions/[versionId]/restore/`
- `[id]/preview/`, `[id]/validate/`, `[id]/test-send/`
- `route.test.ts`

**UI**

- `src/components/crm/templates/`:
  - `template-types.ts`
  - `TemplateParts.tsx` — variable picker, issues, preview, preview-context picker, meta hook
  - `TemplateEditor.tsx`
  - `TemplateDetail.tsx`
  - `TemplateDialogs.tsx` — test send, categories, duplicate
  - `TemplatePickerDialog.tsx` — Inbox
  - `template-components.test.tsx`
- `src/app/(dashboard)/crm/templates/`:
  - `page.tsx`
  - `new/page.tsx`
  - `[id]/page.tsx`
  - `[id]/edit/page.tsx`
  - `_components/TemplatesListClient.tsx`

**Database:** `prisma/migrations/20261011100000_crm_message_templates/migration.sql`.

## 4. Files modified

**Database and errors**

- `prisma/schema.prisma` — 2 models; `CrmMessage.templateId` / `templateVersionId`; `CrmEntityType.TEMPLATE`; back-relations.
- `src/core/errors/BusinessRuleError.ts` — `CRM_TEMPLATE_INVALID` (422).

**Provider layer** (optional, backwards-compatible additions)

- `src/core/communication/CommunicationProvider.ts`:
  - `OutboundTemplateRef`
  - `OutboundMessage.template?` / `test?`
  - `ProviderTemplateCheck`
  - `ChannelProvider.validateTemplate?`
- `src/core/communication/providers/generic-webhook.provider.ts`:
  - sends `template` and `test` only when set;
  - `validateTemplate` checks that sending is set up, the configured text limit and subject support.

**Conversations (Phase 11)**

- `conversation.schema.ts` — send accepts `templateId` + `templateVersionId`, both or neither.
- `conversation-messaging.service.ts` — template resolved after `prepareSend`; ids and metadata saved on the message; audit + `message.sent` / `message.failed` payload carry the template; the provider receives the ref (also on Retry).
- `crm-conversations.service.ts` — message DTO `template`.
- `api/v1/crm/conversations/[id]/messages/route.ts` — multipart fields.
- `components/crm/conversations/ConversationThread.tsx` — "Use template", the template chip, and the bubble label.
- `conversation-types.ts`

**CRM core**

- `crm-entity-types.ts` — TEMPLATE → `/crm/templates`.
- `crm-event-types.ts` — `template.*`.
- `crm-entity-access.ts` — TEMPLATE readable by `crm.view`.
- `contacts/contact-registry.ts` — option list `template_category`.
- `settings/_components/OptionValuesTab.tsx` — that list is managed on the Templates page instead.
- `components/layout/navigation.ts` — CRM → Templates.
- `core/crm-registries.test.ts`

**Docs:** `docs/crm/integrations/README.md` — outbound `template` / `test` fields.

## 5. Database changes

Migration `20261011100000_crm_message_templates`:

**Enum:** `CrmEntityType` + `TEMPLATE`.

**`crm_message_templates`**

- Columns:
  - name and `name_key`
  - `channel_type` (CHECK: the 7 Phase 11 channel types; Email / SMS / WhatsApp enabled in code)
  - `category_id` → `crm_option_values` (SET NULL)
  - description
  - status (DRAFT / ACTIVE / ARCHIVED)
  - `current_version_id` (unique FK) and `current_version_number`
  - `search_text`, `duplicated_from_id`
  - activated / archived stamps
  - created / updated by
  - `version` (optimistic lock) and timestamps
- CHECKs: archived ⇔ `archived_at`; ACTIVE ⇒ has a version; non-empty name.
- Indexes:
  - `(company_id, status, updated_at)`
  - `(company_id, channel_type, status)`
  - `(company_id, category_id)`
  - `(company_id, created_at)`
  - partial unique `(company_id, name_key) WHERE status <> 'ARCHIVED'`

**`crm_message_template_versions`**

- Columns: `template_id`, `version_number`, `subject`, `body`, `variables text[]`, `provider_metadata jsonb`, `change_note`, `restored_from_id`, `created_by`, `created_at`.
- Unique `(template_id, version_number)`.
- **Trigger refusing UPDATE and DELETE** — versions are immutable at database level.

**`crm_messages`**

- New columns `template_id` / `template_version_id` (RESTRICT FKs).
- CHECK: both set or both null; only on outbound messages.
- Partial indexes for usage: `(template_id, occurred_at)` and `(template_version_id)`.

**Verification:**

- Fresh: all 164 migrations + seed, and every Prisma model matches the database (columns, nullability, arrays).
- Upgrade: the Phase 11 e2e database (147 messages) migrated cleanly; models match.

## 6. Template architecture

- **Template:** metadata plus a pointer to its current immutable version. It is a shared company library: every user with `crm.view` sees it.
- **Status:**
  - DRAFT (may hold errors, not offered when sending)
  - ACTIVE (must be error-free; the only status usable for sending)
  - ARCHIVED (read-only, kept forever)
- **Actions:** activate (DRAFT→ACTIVE, re-validated), deactivate (ACTIVE→DRAFT), archive (DRAFT / ACTIVE→ARCHIVED), restore (ARCHIVED→DRAFT, name re-checked).
- **Never hard-deleted.** Archiving is refused with `REFERENCED_RECORD_IN_USE` when a usage provider reports live references (future automations).
- **Channel rules** (`TEMPLATE_CHANNELS`, one entry per channel type):

  | Channel | Subject | Limits | Extras |
  |---|---|---|---|
  | Email | required | 10,000 characters | — |
  | SMS | none | 1,600 characters | GSM-7 / Unicode part counting with warnings |
  | WhatsApp | none | 4,096 characters, warning above 1,024 (approved-template body limit) | optional provider fields `externalTemplateName` + `language` |

  Messenger, Instagram, Website chat and Other are defined but disabled — enabling one is a registry flag.
- **HTML email:** plain text only. The ERP has no HTML email pipeline or rich-text editor, and providers receive `text`; no heavy editor was added.

## 7. Variable / rendering architecture

**Syntax (the only one):** `{{record.field}}` or `{{record.field|fallback}}`.

- Spaces inside the braces are ignored.
- The fallback is literal text: at most 100 characters, no braces, no line breaks.
- `{{` always starts a variable (no escape).

**Policy** (centralised in `template-engine.ts`):

| Case | Rendered as | Reported as |
|---|---|---|
| Unknown variable | empty | error — "Template contains unsupported variable: {{customer.xyz}}." Blocks activate, test and send. |
| Malformed or unclosed `{{` | left as typed | error |
| Known variable without a value | its fallback, else empty | warning `NO_VALUE` (no warning when a fallback is used) |
| Record missing from the context | its fallback, else empty | one warning per record — "Opportunity data is unavailable for this message." |

Values are inserted once and never re-parsed. Line breaks in subject values are flattened.

**Variables** (`TEMPLATE_VARIABLES`; only these are reachable — no arbitrary fields):

| Record | Fields |
|---|---|
| contact | first / last / full name, email, phone, mobile, whatsapp, designation, department, company |
| company | name, legal name, email, phone, website, city, address |
| opportunity | name, number, value (`INR 2,50,000.00`), stage, pipeline, probability, expected close date, owner |
| lead | full / first name, number, source, status, score, company name |
| user (sender) | name, first name, email, phone |
| appointment | title, date, time, end time, time zone, location, meeting link — in the appointment's own time zone |

Quotation fields are reported as unknown with an explanation ("the ERP has no quotation module").

**Context** (`buildTemplateContext`):

- Takes record ids: `contactId`, `companyId`, `opportunityId`, `leadId`, `appointmentId`, `conversationId`, `userId`.
- Fills in related records:
  - conversation → contact, company, opportunity;
  - appointment → its record;
  - opportunity → contact + company;
  - contact → company.
- Explicit ids must be visible to the user (404 otherwise). Related ones the user can't see are left out.
- One query per record type; deterministic output.
- A system actor (automation) has no visibility scope. Callers may also pass ready-made values.
- Adding a record type = one registry entry + one loader.

## 8. Versioning

- Every content change (subject, body, provider settings) adds version N+1 and makes it current.
- Detail changes (name, category, description) are audited in place and do not create a version.
- No-op saves create nothing.
- Optimistic locking (`version`) gives 409 on concurrent edits.
- An ACTIVE template's new version must be valid.
- **Restore version** copies an old version into a NEW version (`restored_from_id`, note "Restored version N").
- **Duplicate** creates a new template (own id, version 1 = the source's current content, `duplicated_from_id`). The source gets a `template.duplicated` event.
- Messages store the final rendered text plus `template_id` + `template_version_id`; metadata keeps `{ name, versionNumber, edited, providerMetadata, parameters }`. Editing or archiving the template never changes them; the FK is RESTRICT.

## 9. Categories

- `crm_option_values` list `template_category`, seeded per company: General, Sales, Follow-up, Appointment, Quotation, Payment, Support, Onboarding, Marketing, Internal.
- Create, rename and archive/restore go through the existing `/api/v1/crm/settings/option-values` (`crm_settings.edit`, audited), from the Templates page's **Categories** dialog.
- Archived categories stay on templates that use them but can't be chosen for others. A category from another list is refused.
- List filter by category.

## 10. Preview

- The editor previews live on the server (`POST /templates/preview`, debounced) with sample data, or with a real contact / company / opportunity / lead chosen in a picker (access enforced).
- The detail page and the test-send dialog preview the stored version (`POST /templates/{id}/preview`).
- The preview shows: subject, text, character count, SMS parts, missing values, errors and warnings (CRM vs provider).

## 11. Test send

`POST /templates/{id}/test-send { channelId, to, confirm: true, versionId?, sample | context }`:

1. Requires an explicit confirmation and one destination: an email for Email; one phone number for SMS / WhatsApp. Lists are refused.
2. The channel must be of the template's type, ACTIVE and able to send.
3. Renders the template (sample data by default) and refuses errors — CRM-level and provider-level (`validateTemplate`).
4. Sends through the channel's provider adapter (the same one the Inbox uses), with `test: true` and "[TEST]" in the subject (email) or at the start of the text.
5. **Nothing is stored in crm_messages.** It is recorded as an audit row (`event: template.test_sent`, success or failure with the provider's safe error code) and, on success, a `template.test_sent` history event.
6. Provider failures return 422 `Test not sent: <safe reason>` (never the provider body or credentials).
7. Limited to 5 per user per minute.

## 12. Phase 11 integration

**Composer:** "Use template" → active templates of the conversation's channel type (search) → preview rendered for this conversation (its contact / company / opportunity, you as sender) → **Insert into reply**. The text stays editable. A chip shows "From template: X (vN)" and can be removed.

**Send:**

- `templateId` + `templateVersionId` are sent with the message.
- The server re-checks DND, capabilities and permission first (unchanged), then:
  - the template is ACTIVE and for this channel type;
  - the version belongs to it.
- It re-renders that version to record whether the text was **edited**, and saves the ids.
- Audit and `message.sent` / `message.failed` events include `templateId`, `templateVersionId`, `templateVersionNumber` and `templateEdited`.
- The relay receives `template` (with `parameters`, empty if edited).

**Thread:** outbound bubbles show "⧉ Template name vN (edited)".

## 13. Provider integration points

- `ChannelProvider.validateTemplate?(channel, { subject, body, providerMetadata, variables })` returns provider-level issues (`source: "provider"`).
- `OutboundMessage.template` gives a provider what it needs to map onto approved templates (e.g. WhatsApp outside 24 h): `providerMetadata.externalTemplateName`, `language`, and `parameters` in order.
- The generic relay forwards it as `template` (documented in `docs/crm/integrations/README.md`). The core template model has no Meta / Twilio / SMTP knowledge.

## 14. Sequence / workflow interfaces

`TemplateService` (`crm-templates.service.ts`):

- `getTemplate`, `listTemplates`
- `validateTemplate`, `validateContent`
- `renderTemplate(actor | crmSystemActor(companyId), templateId, { refs } | { values, entities } | { sample: true }, { versionId?, requireUsable?, channelId? })` → `{ template, version, subject, body, errors, warnings, ok, parameters, missing, sms?, providerMetadata }`
- `previewTemplate`, `previewWithSampleData`
- `sendTest`, `usage`

**Usage registry:** `registerTemplateUsageProvider({ key, label, summarize, countMany })`. A sequence or workflow module reports its references; `activeReferences` block archiving.

**Events:** `template.*` events are available for automation.

## 15. Permissions / security

| Action | Permission |
|---|---|
| View, list, preview, validate, versions, history | `crm.view` |
| Create, duplicate | `crm.create` |
| Edit, activate, deactivate, archive, restore, restore version | `crm.edit` |
| Test send | `crm.create` (same as sending a message) |
| Manage categories | `crm_settings.edit` (existing option-values API) |

- Everything is enforced server-side by `crmRoute`; the UI only hides actions.
- Previews against records use the records' own visibility rules.
- Secrets and provider responses never reach the browser or logs.

## 16. Audit

`AuditLog` rows record:

- template create / duplicate (`event`)
- detail updates (old / new values)
- every version (table `crm_message_template_versions`)
- `template.version_created` / `version_restored`
- activate / deactivate / archive / restore
- test sends (success and failure)
- category changes (existing option-values audit)
- messages sent from a template (message CREATE audit carries the template + version)

`crm_events` (entity TEMPLATE) form the template's History timeline: created, details updated, version saved, version restored, duplicated, activated, deactivated, archived, restored, test sent.

## 17. Tests added (45)

| Kind | Tests |
|---|---|
| Unit (`templates.unit.test.ts`) | 16 — parser (spaces, fallbacks, order), unknown / malformed / unclosed / quotation, invalid fallback, rendering, missing value vs fallback, missing record, no re-parsing, subject flattening, every variable with sample data (deterministic), per-channel rules (email subject, SMS / WhatsApp none, empty body, unsupported channel), SMS parts (GSM-7 / extended / Unicode, limit), WhatsApp length + provider fields, lifecycle, caret insertion |
| Integration, real Postgres (`templates.integration.test.ts`) | 16 — categories via option values (seed, rename, archive, wrong list); create v1 + event + audit; create validation; detail vs content edits, v2 / v3, conflict, no-op; DB refuses UPDATE / DELETE of a version; restore → new version; lifecycle (draft with errors, activation refused, active stays valid, archive read-only, name re-use + restore); duplicate (own id / history, names); list (no bodies, search name + text, filters, usable, sort, paging, counts); rendering with real contact / company / opportunity / lead / user / appointment; preview sample / real / missing / visibility 404 / system actor; test send (signed, [TEST], template ref, nothing in crm_messages, audit + event); test-send refusals (list, no confirm, wrong channel, receive-only, invalid template) + provider failure (safe message, failure audit, no event) + WhatsApp provider metadata / parameters; rate limit; Inbox send from template (draft refused, exact version, relay ref, event / audit fields, edited flag, later edits don't change history, usage per version, wrong channel / version / archived refused, DB pair check); TEMPLATE timeline access |
| API (`templates/route.test.ts`) | 4 — filters / sort / paging parsing, every route → existing permission, 403 before the service, ids / bodies passed, 422 details |
| UI (`template-components.test.tsx`) | 9 — variable picker (groups, filter, pick), issue list, editor create (caret insert, server preview, save), active edit → "Save as version 3?" confirmation, unsaved-changes guard, read-only, test-send dialog (marked, confirm, payload), composer "Use template" (usable filter, conversation preview, insert, send with exact version), bubble label |

**Browser e2e** (dev server on the upgraded database, mock relay verifying the CRM signature): 22 checks, all pass.

- nav + list
- unknown variable blocks activation
- variable inserted at the caret
- live sample preview + preview against a real opportunity
- save & activate
- test send: marked, signed, `[TEST]`, template ref; history shows it
- edit → v2 with confirmation; v1 kept exactly
- Inbox "Use template" rendered for the conversation, sent with v2, bubble label
- usage per version
- restore v1 → v3
- archive (not offered any more)
- history events
- categories dialog
- mobile width (no horizontal scroll)
- no page errors

## 18. Regression results

- Full suite: **172 files, 2,641 tests passing** (with `CRM_IT_DATABASE_URL`).
- `tsc` clean.
- ESLint: 0 errors (the 12 existing warnings).
- Phase 02–11 suites pass unchanged, except the entity-type registry test, which now expects `TEMPLATE`.
- Phase 11 conversation integration tests (24) pass with the send changes.

## 19. Known limitations

- **Plain text only** — no HTML email or rich-text editor (none exists in the ERP; providers receive text).
- **No quotation variables** — the ERP has no quotation module. Add a `quotation` record + loader when it does.
- **Approved-template sending** (e.g. WhatsApp outside 24 h) is up to the provider / bridge using `template.providerMetadata` + `parameters`. No real WhatsApp / SMS / email provider is built in (same as Phase 11).
- **Shared library** — no per-user / private templates, and no per-template permissions (the ERP has none).
- **Composer:** one template per reply; template attachments aren't supported. Test sends use sample data or one chosen record; they are not stored as messages, so delivery receipts for them are not tracked.
- **Usage:** only Inbox messages are counted until sequences / workflows register their providers.
- **Character counts** in the editor are estimated with sample data; the real check happens at send time with real values.

## 20. Recommended extension points for Phase 13

- **Sequences / workflows:** store `templateId`; at run time call `TemplateService.renderTemplate(crmSystemActor(companyId), id, { refs }, { requireUsable: true })` and send through the conversation / provider layer, recording `templateId` + `version.id`. Register a usage provider so active steps block archiving.
- **Reminders / follow-ups:** the appointment and user variables are ready; add a task or activity record if needed (one registry entry + loader).
- **Outbound-initiated conversations:** reuse the Inbox send path with a template when starting a new conversation (needs provider rules such as WhatsApp templates).
- **Rich email:** add an `html` channel capability and an HTML body to versions when an HTML-capable provider exists.

## How to try it

1. Apply the migration: `npx prisma migrate deploy`.
2. CRM → **Templates** → **New template**. Write the text, insert variables, check the preview, then **Save & activate**.
3. On the template, choose **Test send**. This needs a channel with an outbound URL — see `docs/crm/integrations`.
4. CRM → Inbox → open a conversation → **Use template** → **Insert into reply** → **Send**.
