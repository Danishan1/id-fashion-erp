# CRM MODULE — MASTER DEVELOPMENT BLUEPRINT

## Integrated ERP Platform | Claude Code / AI Coding Agent Implementation Plan

**Version:** 1.0
**Date:** 01 October 2026
**Implementation model:** Sequential development through multiple Claude Code prompts
**Module:** CRM inside an existing ERP
**Primary references:** GoHighLevel CRM, Zoho CRM, Automate Business, and publicly observable CoHive-related CRM/workflow concepts
**Companion:** `CRM_INTEGRATION_AWARENESS.md`

---

# 0. HOW TO USE THIS FILE

This is the **master CRM development blueprint**.

Do **not** ask Claude Code to implement the entire CRM in one prompt.

The CRM is a large module and must be developed in controlled phases. Each phase below is intended to become a separate Claude Code prompt.

### Development rule

For every phase:

1. Inspect the existing ERP codebase first.
2. Identify existing reusable services/components before creating anything new.
3. Implement only the requested phase.
4. Do not break existing ERP modules.
5. Run migrations safely.
6. Implement backend/API + frontend/UI + validation + tests.
7. Verify the feature manually.
8. Report:
   - files created
   - files modified
   - database changes
   - APIs added/changed
   - reusable components created
   - tests completed
   - unresolved dependencies
9. Stop after completing the phase unless explicitly instructed to continue.

### Critical architecture rule

CRM is **NOT a standalone ERP/tenant/user-management product**.

The parent ERP already owns:

- Authentication
- Organizations/companies/tenants
- Users/employees
- Roles and permissions
- Global navigation
- Master data where applicable
- Notifications
- Files/documents
- Accounting
- Inventory
- HRMS
- Payroll
- Projects
- Support/tickets
- Products/services
- Quotations/orders/invoices where applicable

CRM should **reuse these systems**.

Do NOT create duplicate:

- User tables
- Employee tables
- Organization tables
- Role systems
- Permission systems
- Product masters
- Customer masters when an authoritative ERP customer entity already exists
- Invoice engines
- Accounting ledgers

CRM is the **relationship, lead, sales-process, communication and automation layer** of the ERP.

---

# 1. PRODUCT VISION

The CRM should combine the strongest CRM concepts from:

### GoHighLevel

Use as the primary benchmark for:

- Contact management
- Smart Lists
- Opportunities
- Pipelines
- Pipeline stages
- Conversations
- Tasks
- Forms
- Workflows
- Workflow triggers/actions
- Custom fields
- Custom objects
- Bulk actions
- Automation
- AI CRM actions

### Zoho CRM

Use as the benchmark for:

- Structured Lead → Contact → Account → Deal lifecycle
- Process governance
- Sales stages
- Cadences/sequences
- Lead scoring
- Blueprint-style stage rules
- Advanced customization
- Reporting
- Analytics
- Customer 360

### Automate Business

Use as a benchmark for practical India-focused sales workflows:

- Lead capture
- Lead assignment
- Follow-up management
- WhatsApp-centric communication
- Sales pipeline
- Small-business sales execution
- Practical automation

### CoHive-derived concepts

Only use publicly observable business-process concepts; do not assume undocumented internal CoHive functionality.

Relevant concepts:

- Customer/member/company records
- Contracts
- Contract extensions
- Relocations
- Terminations
- Quotations
- Agreements/documents
- Customer lifecycle
- Sales-to-customer handoff
- Invoice visibility/linkage

---

# 2. CORE CRM JOURNEY

```text
Lead Capture
    ↓
Lead Qualification
    ↓
Contact / Company
    ↓
Opportunity
    ↓
Pipeline
    ↓
Stage Progression
    ↓
Activities
    ↓
Communication
    ↓
Follow-up
    ↓
Quotation
    ↓
Negotiation
    ↓
Won / Lost
    ↓
Customer
    ↓
Retention / Repeat Opportunity
```

The architecture must remain flexible enough for different industries.

Manufacturing example:

```text
New Enquiry → Requirement Received → Qualified → Demo → Trial → Quotation → Negotiation → Won
```

Real-estate example:

```text
New Lead → Contacted → Site Visit → Negotiation → Booking → Won
```

Solar example:

```text
New Lead → Qualified → Site Survey → Proposal → Negotiation → Installation → Won
```

These pipelines must be configurable rather than hard-coded.

---

# 3. GLOBAL DEVELOPMENT PRINCIPLES

## 3.1 Reuse existing ERP architecture

Before coding any CRM feature, inspect:

```text
- database architecture
- authentication
- users/employees
- organization/tenant model
- permissions
- API conventions
- frontend framework
- design system
- routing
- notifications
- file storage
- logging
- audit system
- background jobs
- existing customer/product/quotation/invoice services
```

Use existing infrastructure whenever possible.

## 3.2 CRM must be modular

Recommended logical modules:

```text
crm/
├── dashboard
├── leads
├── contacts
├── companies
├── opportunities
├── pipelines
├── activities
├── conversations
├── templates
├── sequences
├── forms
├── workflows
├── scoring
├── custom-fields
├── custom-objects
├── campaigns
├── reports
├── analytics
├── ai
├── integrations
└── settings
```

Use the project's actual architecture if different.

## 3.3 Every feature must include

- UI
- API/service
- Database model/migration
- Validation
- Loading state
- Empty state
- Error state
- Success state
- Search/filtering where applicable
- Pagination where applicable
- Audit events where applicable
- Tests
- Responsive behavior
- ERP integration where applicable

---

# 4. MASTER CRM DATA MODEL

Core entities:

```text
Lead, Contact, Company, Opportunity, Pipeline, PipelineStage, Task, Activity,
Conversation, Message, Sequence, SequenceStep, SequenceEnrollment, Form, FormField,
FormSubmission, Workflow, WorkflowTrigger, WorkflowNode, WorkflowExecution,
CustomField, CustomObject, CustomObjectRecord, Campaign, Tag, Template, LeadScore, AuditEvent
```

Relationships:

```text
Company
 ├── Contacts
 ├── Leads
 └── Opportunities

Contact
 ├── Company
 ├── Opportunities
 ├── Activities
 ├── Tasks
 ├── Conversations
 ├── Appointments
 ├── Sequences
 └── Forms/Submissions

Opportunity
 ├── Contact
 ├── Company
 ├── Pipeline
 ├── Stage
 ├── Activities
 ├── Tasks
 ├── Conversations
 └── ERP quotation/order references
```

---

# 5. PHASE 00 — CODEBASE DISCOVERY

```text
You are working inside an existing ERP application.

Before implementing CRM functionality, inspect the entire relevant architecture.

Identify:
1. Frontend framework
2. Backend framework
3. Database/ORM
4. Authentication system
5. User/employee model
6. Organization/tenant model
7. Role/permission system
8. Existing customer/company/contact models
9. Existing product/service models
10. Quotation/order/invoice modules
11. Existing task/activity system
12. Notification system
13. File/document system
14. Audit/logging system
15. Background jobs/queues
16. Existing API conventions
17. Existing design system
18. Existing routing/navigation
19. Existing search/filter infrastructure
20. Existing integration/webhook infrastructure

Do NOT implement CRM yet.

Create an architecture assessment containing:
- reusable components
- reusable services
- existing entities CRM should reference
- entities CRM must create
- potential conflicts
- recommended CRM folder/module structure
- database relationship recommendations
- API conventions
- frontend conventions
- testing conventions

Do not modify production functionality during this discovery phase.
At the end, report the findings and wait for the next CRM implementation phase.
```

---

# 6. PHASE 01 — CRM FOUNDATION

**Goal:** Create the CRM module shell without implementing all CRM features.

**Implement:** CRM navigation · CRM route · dashboard shell · module layout · breadcrumbs · page header · shared CRM table · shared filter · record drawer/modal where useful · shared timeline · CRM API namespace · CRM database namespace/migration foundation · CRM event infrastructure · CRM audit integration

```text
Implement CRM Foundation according to the master CRM blueprint.
First inspect the architecture assessment from Phase 00.
Create the CRM module as a native module inside the existing ERP.

Do not create: authentication, organizations, roles, permissions, employee management.
Reuse existing ERP systems.

Implement:
1. CRM navigation
2. CRM routes
3. CRM layout
4. Dashboard shell
5. Shared table component
6. Shared filter component
7. Shared search component
8. Shared timeline component
9. Shared record header
10. Shared activity component
11. CRM API namespace
12. CRM event infrastructure
13. CRM audit integration
14. CRM error/loading/empty-state patterns

Create the minimum database infrastructure required.
Do not implement Leads, Contacts, Opportunities or Workflows yet.
Ensure the CRM shell does not break existing ERP modules.
Run tests and report changed files.
```

---

# 7. PHASE 02 — LEADS

**Lead fields:** id, first_name, last_name, company_id, contact_id, phone, mobile, whatsapp, email, alternate_email, source, status, owner_id, score, temperature, tags, notes, last_contacted_at, next_followup_at, created_at, updated_at

**Additional configurable fields:** custom fields · UTM parameters · campaign source · referral source · location · industry · requirement · estimated value

**Lead statuses (configurable):** New · Contacted · Qualified · Unqualified · Nurture · Converted · Lost

**Features:** list · search · advanced filtering · sorting · pagination · saved views · Smart Lists foundation · create · edit · archive · assign owner · tags · notes · timeline · convert lead · create opportunity · create contact/company · bulk operations

```text
Implement CRM-LEADS. Build complete Lead Management.

Requirements:
1. Lead database model
2. Lead API
3. Lead list UI
4. Create/edit form
5. Search
6. Filtering
7. Sorting
8. Pagination
9. Owner assignment using ERP employee/user records
10. Lead status
11. Lead source
12. Tags
13. Notes
14. Timeline
15. Custom fields architecture
16. Lead conversion
17. Create opportunity from lead
18. Create contact/company from lead
19. Archive/delete behavior
20. Audit events

Implement proper validation.
Prevent accidental duplicate leads using configurable duplicate rules.
Do not create a duplicate employee/user system.
Add unit/API/UI tests.
Do not implement workflow automation yet.
```

---

# 8. PHASE 03 — LEAD IMPORT & CAPTURE

**Sources (architecture for):** manual entry · CSV · XLSX · website forms · API · webhooks · Meta/Facebook Lead Ads · IndiaMART (where API access exists) · trade portals · referral · manual source

**Features:** import wizard · file upload · column mapping · preview · validation · duplicate detection · import · error file · import history · source attribution

```text
Implement CRM Lead Capture and Import.

Create:
1. CSV/XLSX import
2. Import wizard
3. Column mapping
4. Preview
5. Validation
6. Duplicate handling
7. Import progress
8. Error reporting
9. Import history
10. API lead endpoint
11. Webhook lead endpoint
12. Source attribution

Duplicate policies: skip, update, create, flag for review.
Never silently discard rows.
Large imports must run asynchronously.
Create audit records.
Build the integration architecture so future Meta/Facebook/IndiaMART/other connectors can plug into the same lead-ingestion service.
Do not hard-code external credentials.
```

---

# 9. PHASE 04 — CONTACTS

**Contact profile:** identity · communication · company · designation · address · source · owner · tags · custom fields · DND/contactability · timeline · activities · tasks · opportunities · conversations · appointments · sequences · documents · ERP references

```text
Implement CRM Contacts.
Reuse existing ERP customer/contact entities if they are authoritative.
Do not create duplicate master data unnecessarily.

Implement:
- Contact list, detail, create/edit
- Search, filters, tags, custom fields, owner
- Timeline, activities, tasks, opportunities, conversations, appointments
- Sequence references
- Duplicate detection, merge functionality
- Audit history

Every communication and CRM action should be traceable from the contact timeline.
Use existing ERP user/employee references.
Add tests.
```

---

# 10. PHASE 05 — COMPANIES / ACCOUNTS

**Features:** list · detail · contacts · leads · opportunities · activities · documents · ERP customer · quotations · orders · invoices · support records

```text
Implement CRM Companies/Accounts.
The company record must represent the business relationship without duplicating an existing ERP customer master.

Implement:
- company list, search, filters, create/edit, detail
- associated contacts, leads, opportunities, activities, documents
- ERP customer reference
- quotation, order, invoice references
- support/ticket references where available
- timeline
- duplicate detection, merge

Keep CRM relationship data separate from ERP transactional truth.
Add tests.
```

---

# 11. PHASE 06 — OPPORTUNITIES

**Fields:** name, contact, company, pipeline, stage, status, value, probability, expected_close_date, owner, source, tags, description, custom_fields, created_at, updated_at

**Statuses:** Open · Won · Lost · Abandoned

```text
Implement CRM Opportunities.

Implement:
1. Opportunity model
2. CRUD API
3. List UI
4. Detail UI
5. Contact/company association
6. Pipeline association
7. Stage association
8. Value
9. Probability
10. Expected close date
11. Owner
12. Tags
13. Notes
14. Activities
15. Tasks
16. Attachments
17. Status
18. Timeline
19. ERP quotation reference

Support multiple opportunities for one company/contact.
Every stage/status change must create an audit/timeline event.
Do not build pipeline management yet beyond the minimum relationship needed.
```

---

# 12. PHASE 07 — PIPELINES & STAGES

**Features:** multiple pipelines · pipeline CRUD · stage CRUD · stage ordering · stage probability · default stage · required fields · stage transition rules foundation · opportunity transfer when stage is removed · pipeline board

```text
Implement configurable CRM Pipelines and Stages.

Requirements:
- Multiple pipelines
- Create/edit/archive pipeline
- Create/edit/reorder/archive stage
- Stage probability
- Default stage
- Required fields
- Stage transition configuration
- Safe stage deletion
- Opportunity reassignment when deleting stage
- Pipeline-specific reporting

Build a reusable pipeline engine.
Do not hard-code sales stages.
Add stage history.
Add API tests and UI tests.
```

---

# 13. PHASE 08 — OPPORTUNITY BOARD + LIST

**Features:** Kanban · list · search · filters · drag/drop · bulk assignment · bulk stage change · saved views · configurable cards

```text
Implement Opportunity Board and List Views.

Board: pipeline selector, stage columns, opportunity cards, value totals, drag/drop, stage validation.
List: table, search, filters, sorting, pagination, column selection, saved views.
Bulk operations: assign owner, change stage, update fields, archive.

All drag/drop operations must validate stage rules before committing.
Record stage history.
Add optimistic UI only if rollback is correctly implemented.
```

---

# 14. PHASE 09 — ACTIVITIES, TASKS & FOLLOW-UPS

**Activity types:** Call · Meeting · Task · Note · Email · SMS · WhatsApp · Appointment · Other

**Features:** task list · create task · assign · due date · reminder · priority · complete · reschedule · overdue · related record · timeline

```text
Implement CRM Activities and Follow-ups.
Reuse an existing ERP task/activity service if available.

Implement:
- Task creation, assignment
- Related contact/company/opportunity
- Due date, reminder, priority, status
- Completion, rescheduling, overdue detection
- Activity timeline
- Call logging, meeting logging, notes

Activities must be accessible from Contact, Company and Opportunity.
Completed activities must appear in the record timeline.
Add tests.
```

---

# 15. PHASE 10 — CALENDAR & APPOINTMENTS

**Features:** calendar · day/week/month · appointment · contact · opportunity · employee · time zone · reminder · confirmation · cancellation · reschedule · no-show · workflow event hooks

```text
Implement CRM Appointment Management.
Reuse existing ERP calendar if available.

Implement:
- appointment creation, reschedule, cancellation, status
- assigned employee, contact, company, opportunity
- date/time/timezone, location, video link
- reminders, confirmation, no-show

Expose events for future automation:
appointment.created, appointment.rescheduled, appointment.cancelled,
appointment.completed, appointment.no_show
```

---

# 16. PHASE 11 — UNIFIED CONVERSATIONS

**Channels (architecture):** Email · SMS · WhatsApp · Facebook Messenger · Instagram messaging · Website chat · future channels

**Features:** inbox · thread · search · unread · assignment · internal notes · attachments · reply · contact linking · opportunity linking · task creation · conversation timeline

```text
Implement CRM Unified Conversations.
Build a channel-agnostic conversation architecture.

Core entities: Conversation, Message, Channel, Participant, Assignment, InternalNote

Implement:
- inbox, thread view, unread status, search
- assignment, internal notes, attachments
- contact, company, opportunity association
- task creation, timeline

Create provider adapters rather than hard-coding one communication provider.
Support future: email, SMS, WhatsApp, Facebook, Instagram, live chat.
Unmatched inbound messages must enter an identifiable queue.
Respect DND/contactability policies.
```

---

# 17. PHASE 12 — MESSAGE TEMPLATES

**Features:** email / SMS / WhatsApp templates · variables · preview · test send · categories · version/history · workflow usage

```text
Implement CRM Communication Templates.

Template fields: name, channel, subject, body, variables, category, status, version

Implement: CRUD, duplicate, preview, test send, variable insertion, validation, archive, version history.

Templates must work from manual communication, sequences and workflows.
Missing variables must have predictable fallback behavior.
```

---

# 18. PHASE 13 — SMART LISTS & ADVANCED FILTERS

**Features:** dynamic saved lists · AND conditions · OR groups · nested conditions where supported · custom fields · tags · source · pipeline · stage · activity · engagement · owner · date ranges

```text
Implement Smart Lists.
A Smart List must be a saved query, not a copied static dataset.

Implement: create, edit, duplicate, delete, dynamic evaluation, AND conditions, OR groups,
custom fields, tags, pipeline/stage filters, activity filters, source filters, owner filters,
date filters, saved columns, sorting.

Use server-side filtering.
Smart Lists must be usable by: bulk actions, sequences, workflows, campaigns, exports.
```

---

# 19. PHASE 14 — BULK ACTION ENGINE

**Features:** bulk update · assign · tag · untag · archive · delete · export · workflow enrollment · sequence enrollment · communication · job status · logs · retry

```text
Implement a reusable asynchronous Bulk Action Engine.

It must support: bulk update, bulk assignment, bulk tagging, bulk archive/delete, export,
workflow enrollment, sequence enrollment, communication jobs.

For large datasets: background jobs, progress, success count, failure count, error log,
retry, cancellation where safe.

Never block the browser for large jobs.

Every job must record: initiated_by, started_at, completed_at, status, counts, errors.
```

---

# 20. PHASE 15 — CUSTOM FIELDS

**Field types:** Text · Long Text · Number · Currency · Date · DateTime · Dropdown · Multi-select · Checkbox · Radio · Phone · Email · URL · File/reference where supported

**Objects (minimum):** Lead · Contact · Company · Opportunity · Task · Custom Object

```text
Implement a generic CRM Custom Field Engine.

Requirements: field definitions, field types, internal key, label, description, required,
default value, active/archive, grouping, ordering, validation, field values, API support,
UI rendering, filtering support, Smart List support, workflow support, form support,
reporting support.

Do not allow dangerous field-type changes without migration/validation.
Internal keys should remain stable after publication.
```

---

# 21. PHASE 16 — FORMS

**Features:** form builder · drag/drop · standard fields · custom fields · validation · required fields · styling · preview · publish/unpublish · share/embed · submission list · lead creation/update · workflow trigger

```text
Implement CRM Form Builder.

Create: form model, form field model, form submission model, builder UI, preview,
publish/unpublish, public form endpoint, validation, spam protection architecture,
submission storage, contact matching, lead creation/update, workflow event.

A form must be able to use CRM custom fields.
Every submission must retain source/context/timestamp.
```

---

# 22. PHASE 17 — SALES SEQUENCES / CADENCES

**Steps:** Wait · Email · SMS · WhatsApp · Task · Internal notification · Condition · Exit

**Exit conditions:** reply received · opportunity won · opportunity lost · appointment booked · manual stop · contact unsubscribed

```text
Implement CRM Sales Sequences/Cadences.
A sequence contains ordered steps.

Implement: sequence CRUD, steps, delay, time windows, templates, task steps, enrollment,
pause, resume, stop, exit conditions, enrollment history, step history.

Prevent duplicate enrollment unless explicitly configured.
Respect communication/DND rules.
Expose sequence events for reporting.
```

---

# 23. PHASE 18 — WORKFLOW AUTOMATION ENGINE

**Architecture:** Trigger → Conditions → Branch → Actions → Wait → Action → Goal / Exit

**Triggers:** lead.created · lead.updated · contact.created · contact.updated · form.submitted · opportunity.created · opportunity.updated · opportunity.stage_changed · opportunity.status_changed · task.completed · appointment.booked · appointment.cancelled · appointment.no_show · message.received · tag.added · tag.removed · date.reached · custom_object.created · custom_object.updated · ERP event

**Actions:** create/update contact · create/update company · create/update opportunity · move stage · assign owner · add/remove tag · create task · send email · send SMS · send WhatsApp · internal notification · start/stop sequence · wait · branch · webhook · API call · update custom field · create custom object · add note · create appointment

```text
Implement the CRM Workflow Automation Engine. This is a core platform capability.

Architecture: Trigger → Conditions → Branch → Action → Wait → Action → Goal/Exit

Implement:
1. Workflow definition
2. Trigger registry
3. Condition engine
4. Branch engine
5. Action registry
6. Delay/wait engine
7. Execution engine
8. Execution history
9. Error handling
10. Retry
11. Pause/resume
12. Enable/disable
13. Draft/published states
14. Test mode
15. Execution logs

Critical requirements: idempotency, recursion protection, retry strategy, failure handling,
execution trace, transaction safety, timezone awareness.

Do not hard-code workflow logic for one industry. The system must be configurable.
```

---

# 24. PHASE 19 — WORKFLOW VISUAL BUILDER

**Nodes:** Trigger · Condition · If/Else · Wait · Action · Goal · Exit

```text
Implement the visual Workflow Builder on top of the workflow engine.

Create: canvas, node palette, trigger node, action node, condition node, branch node,
wait node, goal node, edge connections, node configuration panel, validation, save draft,
publish, test, execution preview.

Do not put business logic directly in the UI.
The UI must serialize into the workflow definition consumed by the backend execution engine.
Prevent invalid graphs.
Display validation errors before publishing.
```

---

# 25. PHASE 20 — LEAD SCORING

**Rules can score:** form submission · email engagement · message response · appointment · opportunity value · source · industry · custom field · activity · inactivity

```text
Implement configurable CRM Lead Scoring.

Create: scoring rules, positive points, negative points, conditions, thresholds,
score history, recalculation, hot/warm/cold classification.

Score must be explainable. Display contributing rules/events.
Do not silently use sensitive personal attributes.
Separate deterministic business score from future AI score.
```

---

# 26. PHASE 21 — PROCESS GOVERNANCE / BLUEPRINT

**Purpose:** prevent bad stage transitions.

- `Demo → Trial` may require: demo completed, contact verified, requirement captured.
- `Negotiation → Won` may require: quotation exists, value > 0, decision maker recorded, commercial notes completed.

```text
Implement configurable Opportunity Stage Governance.

For each pipeline stage transition support: required fields, required activity,
required document, allowed transitions, automatic actions, validation messages.

Apply rules to: UI drag/drop, API, workflow, bulk actions.
Do not allow one interface to bypass the rules.
Support authorized override using the existing ERP permission system.
Log successful and failed transitions.
```

---

# 27. PHASE 22 — CAMPAIGNS

**CRM scope only** — track audience, source, communication, enrollment, engagement, opportunity attribution. Do not build a full standalone marketing automation product inside this module.

```text
Implement CRM Campaign Tracking.
Keep scope limited to CRM relationship/outreach tracking.

Implement: campaign CRUD, audience, Smart List integration, source, channel, template,
sequence/workflow connection, enrollment, status, engagement metrics, opportunity attribution.

Avoid duplicating a future dedicated marketing module.
```

---

# 28. PHASE 23 — REPORTING

**Reports:** Lead · Lead Source · Lead Conversion · Opportunity · Pipeline · Stage Conversion · Won/Lost · Activity · Follow-up · Employee Activity · Sequence · Workflow · Campaign

```text
Implement CRM Reporting. Create reusable report infrastructure.

Every report must support appropriate: date range, pipeline, stage, owner, source,
status, company, industry, campaign.

Reports must allow drill-down to underlying records.
Do not create metrics that cannot be traced to source records.
Add export where existing ERP export conventions support it.
```

---

# 29. PHASE 24 — ANALYTICS

**Metrics:** lead volume · qualified lead rate · lead-to-opportunity conversion · opportunity-to-win conversion · pipeline value · won value · average deal value · average sales cycle · activity volume · follow-up completion · stale opportunities · source performance · employee performance · sequence performance · workflow performance

```text
Implement CRM Analytics.

Build: funnel, pipeline analytics, conversion, sales-cycle metrics, activity metrics,
source analytics, owner analytics, stale opportunity analysis, sequence analytics,
workflow analytics.

Every metric must clearly define: numerator, denominator, date context, filters, source data.
Allow drill-down.
Do not present estimates as exact transactional facts.
```

---

# 30. PHASE 25 — CUSTOMER 360

**Combines:** contact · company · leads · opportunities · activities · conversations · appointments · tasks · sequences · forms · quotations · orders · invoices · support tickets · projects · documents

**Important:** CRM does not own ERP transactions. It only references them.

```text
Implement Customer 360.
Create a reusable profile view for Contact and Company.

Sections: identity, summary, timeline, leads, opportunities, activities, conversations,
appointments, tasks, forms, sequences, documents, quotations, orders, invoices, support,
projects, AI summary.

CRM must reference transactional records from their owning ERP modules.
Do not copy mutable ERP transaction data into CRM.
```

---

# 31. PHASE 26 — CUSTOM OBJECTS

**Examples:** Property · Vehicle · Project · Machine · Membership · Site · Dealer · Partner · Contract

**Features:** object definition · fields · records · associations · search · filters · lists · detail pages · workflows · reports

```text
Implement a generic CRM Custom Object Engine.

A custom object must support: definition, fields, records, associations, labels,
list view, detail view, search, filters, workflows, reporting, audit.

Support relationships with: contacts, companies, opportunities, other custom objects.

Do not create custom object types as hard-coded classes unless required by the existing architecture.
Use a scalable metadata-driven architecture.
```

---

# 32. PHASE 27 — AI CRM ASSISTANT

**Read:** find leads · find contacts · find opportunities · summarize records · summarize conversations · analyze pipeline · find overdue follow-ups

**Write:** create task · create contact · create opportunity · update opportunity · add note · add tag · start workflow · create draft communication

**Critical rule:** AI write operations require confirmation unless explicitly approved by an existing automation policy.

```text
Implement an AI CRM Assistant. The AI must operate through controlled CRM tools.

Read tools: search leads, search contacts, search companies, search opportunities,
retrieve timeline, retrieve conversation, retrieve pipeline, retrieve tasks.

Write tools: create task, create contact, create opportunity, update opportunity,
add note, add tag, start workflow.

Every write action requires explicit confirmation unless an existing automation policy permits it.
AI must never invent CRM data.

Log: user, prompt/action, tool, parameters, result, timestamp.
Use existing AI infrastructure if available.
```

---

# 33. PHASE 28 — AI COMMUNICATION ASSISTANT

**Features:** email / WhatsApp / SMS drafting · conversation summary · call summary · follow-up generation · tone · language translation · next-action suggestions

```text
Implement AI communication assistance.

Support: email draft, WhatsApp draft, SMS draft, conversation summary, opportunity summary,
call summary, follow-up draft, tone selection, language conversion, next action suggestion.

The AI must use actual CRM context.
Never invent: prices, dates, commitments, customer requirements, product details.
Generated content must remain editable before sending.
```

---

# 34. PHASE 29 — APIs & WEBHOOKS

**Architecture:** CRM API · Webhook Receiver · Webhook Publisher · Integration Adapter · Retry Queue · Integration Logs

**Events:** lead.created · lead.updated · contact.created · contact.updated · company.created · opportunity.created · opportunity.updated · opportunity.stage_changed · opportunity.won · opportunity.lost · task.created · task.completed · appointment.created · message.received · message.sent · form.submitted · workflow.completed · sequence.completed

```text
Implement CRM API and Webhook Infrastructure. Create stable API contracts.

Implement: inbound webhooks, outbound webhooks, event registry, signatures where supported,
idempotency, retries, failure queue, logs.

Do not expose secrets.

Every event should have: event_id, event_type, timestamp, source, entity_id, payload, correlation_id.

Document every public API endpoint.
```

---

# 35. PHASE 30 — CRM SETTINGS

**Settings:** lead statuses · lead sources · tags · pipelines · stages · custom fields · custom objects · templates · sequences · workflows · scoring · forms · appointment types · duplicate rules · communication policies · data retention

```text
Implement CRM-specific settings only. Do not recreate ERP-wide settings.
All configurable CRM values should be managed from a centralized CRM settings area.
Use existing ERP authorization.
Changes must be audited where appropriate.
```

---

# 36. PHASE 31 — DATA QUALITY & AUDIT

**Track:** created · updated · created by · updated by · field changes · merge · import · bulk job · workflow execution · stage movement · ownership change · status change · deletion/archive · AI actions

```text
Implement CRM Data Governance. Every important CRM mutation must be auditable.

Implement: audit events, field history for critical entities, merge history, import history,
bulk-job history, workflow execution history, AI action history, archive/delete history.

Use append-oriented audit records.
Do not expose audit data to unauthorized users.
```

---

# 37. PHASE 32 — CRM DASHBOARD

**KPI cards:** Total Leads · New Leads · Qualified Leads · Open Opportunities · Pipeline Value · Won Value · Conversion Rate · Today's Follow-ups · Overdue Follow-ups · Upcoming Appointments · Hot Leads

**Widgets:** Pipeline · Lead Source · Funnel · Activities · Follow-ups · Stale Opportunities · Lead Score · Conversations · Appointments · Won/Lost · Revenue/Opportunity

```text
Complete CRM Dashboard. Use the data and APIs already implemented.

Implement: KPI cards, pipeline widget, lead source widget, funnel, activity widget,
overdue follow-ups, stale opportunities, conversations, appointments, lead scoring, won/lost trend.

All widgets must support appropriate filters.
Every KPI must drill down to underlying records.
```

---

# 38. PHASE 33 — PERFORMANCE & SCALE

The CRM may eventually contain 100,000+ / 1,000,000+ / 10,000,000+ records depending on deployment.

Scalable patterns: server-side pagination · indexed search · background jobs · asynchronous bulk actions · cached analytics where appropriate · database indexes · query optimization · lazy loading · virtualized lists where appropriate

```text
Audit CRM performance.

Identify: slow queries, missing indexes, N+1 queries, oversized API responses,
inefficient filters, synchronous bulk operations, expensive dashboard calculations.

Optimize without changing business behavior.
Add performance tests for major list/search endpoints.
```

---

# 39. PHASE 34 — SECURITY

Check: authentication · authorization · tenant isolation · input validation · API authorization · file access · webhook security · rate limiting · audit logs · secret handling · XSS prevention · SQL injection prevention · CSRF where applicable · communication consent/DND

```text
Perform a CRM security review. Do not create a new permission system.
Use the ERP authorization layer.

Verify: tenant isolation, record authorization, API authorization, file authorization,
webhook validation, input validation, output escaping, secret handling, rate limiting, audit logging.

Report and fix security issues without changing intended business functionality.
```

---

# 40. PHASE 35 — FINAL CRM INTEGRATION

CRM should connect (only where those modules exist) to: Customer · Product · Quotation · Order · Invoice · Payment · Inventory · Support · Project · HR/employee · Notification · Documents

```text
Perform final CRM-to-ERP integration. Review all CRM features.
Connect CRM to existing ERP modules without duplicating source-of-truth data.

Verify: customer, employee, quotation, order, invoice, payment, support, project references;
notification services; documents.

Do not redesign existing ERP modules.
Add integration tests.
```

---

# 41. PHASE 36 — COMPLETE CRM TESTING

- **Unit:** models, services, validation, scoring, workflow conditions, pipeline rules
- **API:** CRUD, authorization, filtering, pagination, imports, webhooks, bulk jobs
- **UI:** forms, tables, filters, board, drag/drop, conversations, workflows
- **Integration:** CRM ↔ ERP, messaging, forms, workflow, quotations
- **E2E:**
  - Lead capture → Qualification → Contact → Opportunity → Pipeline → Follow-up → Quotation → Won
  - Lead → Workflow → WhatsApp/email → Task → Appointment → Opportunity

```text
Perform full CRM QA.

Create and execute:
1. Unit tests
2. API tests
3. UI tests
4. Integration tests
5. End-to-end tests
6. Workflow tests
7. Bulk operation tests
8. Import tests
9. Security tests
10. Regression tests

Do not mark the CRM complete while critical failures remain.
Provide a final test report.
```

---

# 42. PHASE 37 — PRODUCTION READINESS

```text
Perform final CRM production-readiness review.

Check: migrations, database indexes, API documentation, error handling, logging, monitoring,
queues, retries, environment variables, secrets, permissions, tenant isolation, performance,
backups, audit, workflow safety, communication safety, data export, data recovery.

Create a production-readiness checklist.
Do not make destructive changes automatically.
```

---

# 43. UNIVERSAL ACCEPTANCE CRITERIA

```text
[ ] UI implemented
[ ] Backend/API implemented
[ ] Database implemented
[ ] Validation implemented
[ ] Loading state implemented
[ ] Empty state implemented
[ ] Error state implemented
[ ] Success state implemented
[ ] Search implemented where applicable
[ ] Filtering implemented where applicable
[ ] Pagination implemented where applicable
[ ] Audit implemented where applicable
[ ] Existing ERP services reused
[ ] No duplicate ERP infrastructure created
[ ] Tests written
[ ] Tests pass
[ ] Existing ERP functionality still works
[ ] Documentation updated
```

---

# 44. FINAL CRM FEATURE INVENTORY

- **Core CRM:** dashboard, leads, lead capture, lead import, contacts, companies, opportunities, pipelines, stages, Kanban, list views, activities, tasks, follow-ups, calendar, appointments
- **Communication:** unified inbox, email, SMS, WhatsApp architecture, social messaging architecture, templates, internal notes, attachments
- **Automation:** workflows, triggers, conditions, branches, actions, waits, goals, sequences, cadences, lead scoring, stage governance
- **Customization:** custom fields, custom objects, associations, Smart Lists, saved views, dynamic filters, forms, surveys
- **Intelligence:** reports, analytics, funnels, Customer 360, AI CRM assistant, AI communication assistant
- **Platform:** APIs, webhooks, integrations, audit, bulk operations, import/export, data governance, security, performance

---

# 45. DEVELOPMENT ORDER — DO NOT CHANGE WITHOUT REASON

```text
00 Codebase Discovery → 01 CRM Foundation → 02 Leads → 03 Lead Capture & Import →
04 Contacts → 05 Companies → 06 Opportunities → 07 Pipelines & Stages →
08 Opportunity Board/List → 09 Activities & Tasks → 10 Calendar → 11 Conversations →
12 Templates → 13 Smart Lists → 14 Bulk Actions → 15 Custom Fields → 16 Forms →
17 Sequences → 18 Workflow Engine → 19 Workflow Builder → 20 Lead Scoring →
21 Process Governance → 22 Campaigns → 23 Reports → 24 Analytics → 25 Customer 360 →
26 Custom Objects → 27 AI CRM Assistant → 28 AI Communication → 29 APIs/Webhooks →
30 CRM Settings → 31 Audit/Data Governance → 32 Dashboard → 33 Performance →
34 Security → 35 ERP Integration → 36 Full QA → 37 Production Readiness
```

---

# 46. IMPORTANT CLAUDE CODE OPERATING RULE

Never interpret this document as "Build everything now." Each prompt identifies one phase:

```text
MASTER CRM BLUEPRINT:
[This file]

CURRENT PHASE:
CRM-XXX

IMPLEMENT ONLY:
[Current phase requirements]

DO NOT IMPLEMENT:
[Future modules]

DEPENDENCIES:
[Completed previous phases]

ACCEPTANCE CRITERIA:
[Requirements]

WHEN COMPLETE:
Report files, migrations, APIs, tests and unresolved issues.
STOP.
```

---

# 47. CRM ARCHITECTURAL END STATE

```text
                         INTEGRATED ERP
                              │
        ┌─────────────────────┼─────────────────────┐
       CRM                   HRMS               INVENTORY
        │                     │                     │
   ┌────┴────┐           Employees            Products / Stock / Warehouses
 Leads    Contacts
   └────┬────┘
   Companies → Opportunities → Pipelines → Stages → Activities / Tasks →
   Conversations → Sequences → Workflows → Forms → Smart Lists → Scoring →
   Analytics → Customer 360 → AI
```

The CRM becomes the ERP's **customer-facing relationship and sales operating layer**, while other ERP modules remain the systems of record for their respective business domains.

---

# 48. REFERENCE PRINCIPLE

Do not clone another product's interface pixel-for-pixel. Clone the **capability model and useful workflows**, then adapt to the existing ERP architecture.

```text
GoHighLevel + Zoho CRM + Automate Business + CoHive-derived lifecycle concepts + existing ERP capabilities
= Native ERP CRM
```

The resulting CRM should be: configurable · automation-first · communication-ready · sales-process driven · AI-ready · scalable · ERP-integrated · industry-neutral · developer/AI-agent maintainable.

---

# 49. AGREED WORKING PROCESS (2026-10-01)

For each phase: (1) inspect + short plan and open decisions → (2) build on branch `crm-marketing-rebuild` → (3) automated checks: unit/API tests, `tsc`, ESLint, migration on a fresh DB + seed, full existing suite → (4) user tests manually on Windows (`npx prisma migrate deploy`, `npm run dev`) with a checklist → (5) fixes/enhancements → (6) report, update `CLAUDE.md` + `danishan-understanding.md`, commit when asked → next phase.

Every phase also checks `CRM_INTEGRATION_AWARENESS.md`: does this phase need an external integration? If not, none is built.

# END OF MASTER CRM DEVELOPMENT BLUEPRINT
